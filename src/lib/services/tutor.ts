import "server-only";
import { z } from "zod";
import { db, newId, nowIso, parseJson } from "@/lib/db";
import { generateJson, getLLM } from "@/lib/ai";
import { QUICK_ACTIONS, SOCRATIC_ADDON, TUTOR_SYSTEM, adaptiveNote, checksPrompt, lessonPrompt } from "@/lib/ai/prompts";
import { formatSources, retrieve, type SourceRef } from "@/lib/rag/retrieve";
import { seededShuffle } from "@/lib/learning/grading";
import { verifyCitations, type Verification } from "@/lib/learning/citations";
import { numericString } from "./quiz";
import { getSettings } from "@/lib/settings";
import { logGeneration } from "./generations";
import { getTopic, recordEvent, topicSectionIds } from "./topics";
import { scheduleAutoNotes } from "./notes";
import { isLive, startLive, subscribe, type LiveEvent } from "./live";

/**
 * The AI tutor. Each course topic has one thread with ordered messages, the
 * student's unsent draft and a resume position. Answers and lessons are written
 * in the background (see live.ts), so they survive switching screens, and are
 * checkpointed so a restart shows an "interrupted" answer with a Retry button.
 */

export type MessageStatus = "streaming" | "complete" | "interrupted" | "failed";

interface MessageRow {
  id: string;
  topic_id: string;
  thread_id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  action: string | null;
  strategy: string | null;
  sources: string;
  generation_id: string | null;
  status: MessageStatus;
  client_id: string | null;
  reply_to: string | null;
  verification: string | null;
  options: string | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface KnowledgeCheck {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface LessonRow {
  id: string;
  topic_id: string;
  content: string;
  sources: string;
  checks: string;
  model: string | null;
  status: MessageStatus;
  verification: string | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
}

// ---------------------------------------------------------------- threads

export function ensureThread(topicId: string) {
  const existing = db().prepare("SELECT * FROM tutor_threads WHERE topic_id = ?").get(topicId) as ThreadRow | undefined;
  if (existing) return existing;
  const topic = getTopic(topicId);
  if (!topic) throw new Error("Topic not found");
  const now = nowIso();
  db()
    .prepare("INSERT OR IGNORE INTO tutor_threads (id, course_id, topic_id, draft, last_active_at, created_at) VALUES (?,?,?, '', ?, ?)")
    .run(newId(), topic.course_id, topicId, now, now);
  return db().prepare("SELECT * FROM tutor_threads WHERE topic_id = ?").get(topicId) as ThreadRow;
}

interface ThreadRow {
  id: string;
  course_id: string;
  topic_id: string;
  draft: string;
  resume_message_id: string | null;
  last_active_at: string;
  created_at: string;
}

export function getThread(topicId: string) {
  const t = db().prepare("SELECT * FROM tutor_threads WHERE topic_id = ?").get(topicId) as ThreadRow | undefined;
  return t ?? null;
}

export function updateThread(topicId: string, patch: { draft?: string; resumeMessageId?: string | null }) {
  const t = ensureThread(topicId);
  db()
    .prepare("UPDATE tutor_threads SET draft = ?, resume_message_id = ? WHERE id = ?")
    .run(patch.draft !== undefined ? patch.draft.slice(0, 8000) : t.draft, patch.resumeMessageId !== undefined ? patch.resumeMessageId : t.resume_message_id, t.id);
  return getThread(topicId)!;
}

const publicMessage = (m: MessageRow) => ({
  id: m.id,
  seq: m.seq,
  role: m.role,
  content: m.content,
  action: m.action,
  status: m.status,
  error: m.error,
  reply_to: m.reply_to,
  client_id: m.client_id,
  generation_id: m.generation_id,
  sources: parseJson<SourceRef[]>(m.sources, []),
  verification: parseJson<Verification | null>(m.verification, null),
  created_at: m.created_at,
});
export type ChatMessage = ReturnType<typeof publicMessage>;

export function getChat(topicId: string): ChatMessage[] {
  return (db().prepare("SELECT * FROM chat_messages WHERE topic_id = ? ORDER BY seq, created_at").all(topicId) as MessageRow[]).map(publicMessage);
}

export function getMessage(id: string) {
  const m = db().prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as MessageRow | undefined;
  return m ? publicMessage(m) : null;
}

export function clearChat(topicId: string) {
  db().prepare("DELETE FROM chat_messages WHERE topic_id = ?").run(topicId);
  db().prepare("UPDATE tutor_threads SET resume_message_id = NULL WHERE topic_id = ?").run(topicId);
}

/** The most recent study session, for Home's "Pick up where you left off". */
export function resumeTarget() {
  const r = db()
    .prepare(
      `SELECT th.topic_id, th.last_active_at, t.title topic_title, c.id course_id, c.title course_title, c.code course_code, c.color course_color,
         (SELECT status FROM chat_messages m WHERE m.thread_id = th.id ORDER BY seq DESC LIMIT 1) last_status,
         (SELECT status FROM lessons l WHERE l.topic_id = th.topic_id ORDER BY created_at DESC LIMIT 1) lesson_status
       FROM tutor_threads th JOIN topics t ON t.id = th.topic_id JOIN courses c ON c.id = th.course_id
       ORDER BY th.last_active_at DESC LIMIT 1`,
    )
    .get() as
    | { topic_id: string; last_active_at: string; topic_title: string; course_id: string; course_title: string; course_code: string | null; course_color: string; last_status: string | null; lesson_status: string | null }
    | undefined;
  return r ?? null;
}

function touchThread(topicId: string) {
  db().prepare("UPDATE tutor_threads SET last_active_at = ? WHERE topic_id = ?").run(nowIso(), topicId);
}

// ---------------------------------------------------------------- context

async function topicContext(topicId: string, query: string, limit = 6) {
  const topic = getTopic(topicId);
  if (!topic) throw new Error("Topic not found");
  const { chunks, mode } = await retrieve({
    courseId: topic.course_id,
    query: `${topic.title}. ${topic.keywords.join(", ")}. ${query}`,
    preferSectionIds: topicSectionIds(topicId),
    limit,
  });
  return { topic, chunks, mode, ...formatSources(chunks) };
}

/** Signals used to adapt teaching when a student is struggling. */
function struggleSignals(topicId: string) {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const wrong = (db()
    .prepare("SELECT COUNT(*) n FROM learning_events WHERE topic_id = ? AND kind IN ('check','quiz') AND score < 0.5 AND created_at >= ?")
    .get(topicId, since) as { n: number }).n;
  const msgs = db().prepare("SELECT action, strategy FROM chat_messages WHERE topic_id = ? AND created_at >= ? ORDER BY seq").all(topicId, since) as {
    action: string | null;
    strategy: string | null;
  }[];
  return {
    wrongAnswers: wrong,
    simplerRequests: msgs.filter((m) => m.action === "simpler").length,
    usedStrategies: msgs.map((m) => m.strategy).filter((s): s is string => Boolean(s)),
  };
}

// ---------------------------------------------------------------- tutor messages

export interface SendInput {
  topicId: string;
  message?: string;
  action?: string;
  socratic?: boolean;
  /** Random id from the app; sending the same id twice never creates a second message. */
  clientId?: string;
}

/**
 * Store the student's message and an empty "streaming" answer, then write the
 * answer in the background. Returns immediately.
 */
export function sendTutorMessage(input: SendInput): { userMessageId: string; assistantMessageId: string; duplicate: boolean } {
  const quick = input.action ? QUICK_ACTIONS[input.action] : undefined;
  const userText = (quick ? quick.label : input.message ?? "").trim().slice(0, 4000);
  if (!userText) throw new Error("Type a question first.");
  if (input.clientId) {
    const prior = db().prepare("SELECT id FROM chat_messages WHERE topic_id = ? AND client_id = ?").get(input.topicId, input.clientId) as { id: string } | undefined;
    if (prior) {
      const answer = db().prepare("SELECT id FROM chat_messages WHERE reply_to = ? ORDER BY seq LIMIT 1").get(prior.id) as { id: string } | undefined;
      if (answer) return { userMessageId: prior.id, assistantMessageId: answer.id, duplicate: true };
    }
  }
  const thread = ensureThread(input.topicId);
  const now = nowIso();
  const userId = newId();
  const answerId = newId();
  db().transaction(() => {
    const seq = ((db().prepare("SELECT MAX(seq) s FROM chat_messages WHERE thread_id = ?").get(thread.id) as { s: number | null }).s ?? 0) + 1;
    db()
      .prepare("INSERT INTO chat_messages (id, topic_id, thread_id, seq, role, content, action, sources, status, client_id, created_at, updated_at) VALUES (?,?,?,?, 'user', ?, ?, '[]', 'complete', ?, ?, ?)")
      .run(userId, input.topicId, thread.id, seq, userText, input.action ?? null, input.clientId ?? null, now, now);
    db()
      .prepare("INSERT INTO chat_messages (id, topic_id, thread_id, seq, role, content, action, sources, status, reply_to, options, created_at, updated_at) VALUES (?,?,?,?, 'assistant', '', ?, '[]', 'streaming', ?, ?, ?, ?)")
      .run(answerId, input.topicId, thread.id, seq + 1, input.action ?? null, userId, JSON.stringify({ socratic: Boolean(input.socratic), message: quick ? null : userText }), now, now);
    db().prepare("UPDATE tutor_threads SET draft = '', resume_message_id = ?, last_active_at = ? WHERE id = ?").run(answerId, now, thread.id);
  })();
  generateAnswer(answerId);
  return { userMessageId: userId, assistantMessageId: answerId, duplicate: false };
}

/** Retry an interrupted or failed answer in place (same message, so no duplicates). */
export function retryAnswer(messageId: string): boolean {
  const m = db().prepare("SELECT * FROM chat_messages WHERE id = ? AND role = 'assistant'").get(messageId) as MessageRow | undefined;
  if (!m) throw new Error("Message not found");
  if (m.status === "complete") return false;
  if (m.status === "streaming" && isLive(`msg:${m.id}`)) return false;
  db().prepare("UPDATE chat_messages SET content = '', status = 'streaming', error = NULL, verification = NULL, updated_at = ? WHERE id = ?").run(nowIso(), m.id);
  generateAnswer(m.id);
  return true;
}

function generateAnswer(answerId: string) {
  const row = db().prepare("SELECT * FROM chat_messages WHERE id = ?").get(answerId) as MessageRow;
  const opts = parseJson<{ socratic?: boolean; message?: string | null }>(row.options, {});
  const quick = row.action ? QUICK_ACTIONS[row.action] : undefined;
  const userText = quick ? quick.prompt : opts.message ?? "";
  const userRow = row.reply_to ? (db().prepare("SELECT seq FROM chat_messages WHERE id = ?").get(row.reply_to) as { seq: number } | undefined) : undefined;
  const checkpoint = db().prepare("UPDATE chat_messages SET content = ?, updated_at = ? WHERE id = ? AND status = 'streaming'");
  let refs: SourceRef[] = [];
  let strategy: string | null = null;
  let genId: string | null = null;

  startLive(
    `msg:${answerId}`,
    async (emit, meta) => {
      const history = (db()
        .prepare("SELECT role, content FROM chat_messages WHERE topic_id = ? AND seq < ? AND status = 'complete' ORDER BY seq DESC LIMIT 8")
        .all(row.topic_id, userRow?.seq ?? row.seq) as { role: string; content: string }[]).reverse();
      const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
      const ctx = await topicContext(row.topic_id, `${opts.message ?? ""} ${quick ? lastUser : ""}`.trim(), 6);
      refs = ctx.refs;
      db().prepare("UPDATE chat_messages SET sources = ? WHERE id = ?").run(JSON.stringify(refs), answerId);
      meta({ sources: refs, mode: ctx.mode });
      const adapt = adaptiveNote(struggleSignals(row.topic_id));
      strategy = adapt.strategy;
      if (strategy) meta({ adaptive: true, strategy });
      const hasLesson = Boolean(db().prepare("SELECT 1 FROM lessons WHERE topic_id = ? AND status = 'complete'").get(row.topic_id));
      const system =
        TUTOR_SYSTEM +
        (opts.socratic ? SOCRATIC_ADDON : "") +
        `\n\nCurrent topic: "${ctx.topic.title}".${ctx.topic.objectives.length ? ` Objectives: ${ctx.topic.objectives.join("; ")}.` : ""}` +
        (hasLesson ? `\nThe student has read a lesson on this topic already.` : "") +
        adapt.note;
      const messages = [
        { role: "system" as const, content: system },
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 2500) })),
        { role: "user" as const, content: `${ctx.block}\n\n${userText}` },
      ];
      const llm = getLLM();
      const started = Date.now();
      let text = "";
      for await (const piece of llm.stream({ messages, think: getSettings().thinking, usage: { task: "tutor", replyId: answerId } })) {
        text += piece;
        emit(piece);
      }
      genId = logGeneration({ task: "tutor", model: llm.model, prompt: JSON.stringify(messages), output: text, durationMs: Date.now() - started, refId: row.topic_id });
    },
    {
      checkpoint: (text) => checkpoint.run(text, nowIso(), answerId),
      complete: (text) => {
        const v = verifyCitations(text, refs.length);
        db()
          .prepare("UPDATE chat_messages SET content = ?, status = 'complete', strategy = ?, generation_id = ?, verification = ?, error = NULL, updated_at = ? WHERE id = ?")
          .run(text, strategy, genId, JSON.stringify(v), nowIso(), answerId);
        touchThread(row.topic_id);
        scheduleAutoNotes(row.topic_id);
      },
      fail: (text, e) => {
        db().prepare("UPDATE chat_messages SET content = ?, status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(text, e.message.slice(0, 500), nowIso(), answerId);
      },
    },
  );
}

export function followMessage(id: string, from: number): AsyncGenerator<LiveEvent> {
  return subscribe(`msg:${id}`, from, () => {
    const m = db().prepare("SELECT content, status, error, sources FROM chat_messages WHERE id = ?").get(id) as Pick<MessageRow, "content" | "status" | "error" | "sources"> | undefined;
    if (!m) return { text: "", status: "failed", error: "Message not found" };
    return { text: m.content, status: m.status, error: m.error, meta: { sources: parseJson(m.sources, []) } };
  });
}

// ---------------------------------------------------------------- lessons

const publicLesson = (r: LessonRow) => ({
  id: r.id,
  topic_id: r.topic_id,
  content: r.content,
  status: r.status,
  error: r.error,
  model: r.model,
  sources: parseJson<SourceRef[]>(r.sources, []),
  checks: parseJson<KnowledgeCheck[]>(r.checks, []),
  verification: parseJson<Verification | null>(r.verification, null),
  created_at: r.created_at,
});

export function getLesson(topicId: string) {
  const r = db().prepare("SELECT * FROM lessons WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1").get(topicId) as LessonRow | undefined;
  return r ? publicLesson(r) : null;
}

/** Start (or return the running/finished) lesson for a topic. */
export function startLesson(topicId: string, regenerate = false): string {
  const latest = getLesson(topicId);
  if (latest && latest.status === "streaming" && isLive(`lesson:${latest.id}`)) return latest.id;
  if (latest && !regenerate && latest.status === "complete") return latest.id;
  if (latest && (latest.status === "interrupted" || latest.status === "failed" || (latest.status === "streaming" && !isLive(`lesson:${latest.id}`))) && !regenerate) {
    retryLesson(latest.id);
    return latest.id;
  }
  const id = newId();
  const now = nowIso();
  db().prepare("INSERT INTO lessons (id, topic_id, content, sources, checks, status, created_at, updated_at) VALUES (?,?, '', '[]', '[]', 'streaming', ?, ?)").run(id, topicId, now, now);
  ensureThread(topicId);
  touchThread(topicId);
  generateLesson(id);
  return id;
}

export function retryLesson(id: string) {
  const r = db().prepare("SELECT status FROM lessons WHERE id = ?").get(id) as { status: string } | undefined;
  if (!r || r.status === "complete" || isLive(`lesson:${id}`)) return false;
  db().prepare("UPDATE lessons SET content = '', status = 'streaming', error = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
  generateLesson(id);
  return true;
}

function generateLesson(lessonId: string) {
  const row = db().prepare("SELECT * FROM lessons WHERE id = ?").get(lessonId) as LessonRow;
  const checkpoint = db().prepare("UPDATE lessons SET content = ?, updated_at = ? WHERE id = ? AND status = 'streaming'");
  let refs: SourceRef[] = [];
  let model = "";
  startLive(
    `lesson:${lessonId}`,
    async (emit, meta) => {
      const t = getTopic(row.topic_id);
      const ctx = await topicContext(row.topic_id, t ? `${t.summary ?? ""} ${t.objectives.join(" ")}` : "", 7);
      if (!ctx.chunks.length) throw new Error("No course material found for this topic yet.");
      refs = ctx.refs;
      db().prepare("UPDATE lessons SET sources = ? WHERE id = ?").run(JSON.stringify(refs), lessonId);
      meta({ sources: refs, mode: ctx.mode });
      const prompt = lessonPrompt(ctx.topic, ctx.block);
      const llm = getLLM();
      model = llm.model;
      const started = Date.now();
      let text = "";
      for await (const piece of llm.stream({ messages: [{ role: "system", content: TUTOR_SYSTEM }, { role: "user", content: prompt }], think: false, usage: { task: "lesson" } })) {
        text += piece;
        emit(piece);
      }
      logGeneration({ task: "lesson", model: llm.model, prompt, output: text, durationMs: Date.now() - started, refId: lessonId });
    },
    {
      checkpoint: (text) => checkpoint.run(text, nowIso(), lessonId),
      complete: (text) => {
        db()
          .prepare("UPDATE lessons SET content = ?, status = 'complete', model = ?, verification = ?, error = NULL, updated_at = ? WHERE id = ?")
          .run(text, model, JSON.stringify(verifyCitations(text, refs.length)), nowIso(), lessonId);
        const t = getTopic(row.topic_id);
        if (t) db().prepare("INSERT INTO learning_events (id, course_id, topic_id, kind, score, created_at) VALUES (?,?,?,?,?,?)").run(newId(), t.course_id, t.id, "lesson_view", 0, nowIso());
        touchThread(row.topic_id);
        scheduleAutoNotes(row.topic_id);
      },
      fail: (text, e) => {
        db().prepare("UPDATE lessons SET content = ?, status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(text, e.message.slice(0, 500), nowIso(), lessonId);
      },
    },
  );
}

export function followLesson(id: string, from: number): AsyncGenerator<LiveEvent> {
  return subscribe(`lesson:${id}`, from, () => {
    const r = db().prepare("SELECT content, status, error, sources FROM lessons WHERE id = ?").get(id) as Pick<LessonRow, "content" | "status" | "error" | "sources"> | undefined;
    if (!r) return { text: "", status: "failed", error: "Lesson not found" };
    return { text: r.content, status: r.status, error: r.error, meta: { sources: parseJson(r.sources, []) } };
  });
}

/** On startup: anything that was mid-generation when the app closed becomes "interrupted". */
export function markInterruptedGenerations() {
  const n1 = db().prepare("UPDATE chat_messages SET status = 'interrupted', updated_at = ? WHERE status = 'streaming'").run(nowIso()).changes;
  const n2 = db().prepare("UPDATE lessons SET status = 'interrupted', updated_at = ? WHERE status = 'streaming'").run(nowIso()).changes;
  return n1 + n2;
}

// ---------------------------------------------------------------- knowledge checks

const checksSchema = z.object({
  checks: z
    .array(
      z.object({
        question: z.string().min(5),
        options: z.array(z.string().min(1)).length(4),
        correctIndex: z.preprocess(numericString, z.number().int().min(0).max(3)),
        explanation: z.string().default(""),
      }),
    )
    .min(1)
    .max(5),
});

/** Knowledge checks for the lesson (generated once, cached with the lesson). */
export async function lessonChecks(topicId: string): Promise<KnowledgeCheck[]> {
  const lesson = db().prepare("SELECT * FROM lessons WHERE topic_id = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1").get(topicId) as LessonRow | undefined;
  const cached = parseJson<KnowledgeCheck[]>(lesson?.checks, []);
  if (cached.length) return cached;
  const ctx = await topicContext(topicId, "key facts definitions", 5);
  const prompt = checksPrompt(ctx.block, ctx.topic.title);
  const started = Date.now();
  const res = await generateJson(checksSchema, { messages: [{ role: "system", content: TUTOR_SYSTEM }, { role: "user", content: prompt }], temperature: 0.3, usage: { task: "checks" } });
  // Shuffle options so the right answer isn't always in the same spot.
  const checks = res.checks.map((c, i) => {
    const order = seededShuffle([0, 1, 2, 3], `${topicId}-${i}-${c.question}`);
    return { question: c.question, options: order.map((o) => c.options[o]), correctIndex: order.indexOf(c.correctIndex), explanation: c.explanation };
  });
  logGeneration({ task: "checks", model: getLLM().model, prompt, output: JSON.stringify(res), durationMs: Date.now() - started, refId: topicId });
  if (lesson) db().prepare("UPDATE lessons SET checks = ? WHERE id = ?").run(JSON.stringify(checks), lesson.id);
  return checks;
}

export function answerCheck(topicId: string, correct: boolean) {
  const t = getTopic(topicId);
  if (!t) return;
  recordEvent({ courseId: t.course_id, topicId, kind: "check", score: correct ? 1 : 0 });
}
