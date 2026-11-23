import "server-only";
import { z } from "zod";
import { db, newId, nowIso, parseJson } from "@/lib/db";
import { generateJson, getLLM, requireChatModel } from "@/lib/ai";
import { QUICK_ACTIONS, SOCRATIC_ADDON, TUTOR_SYSTEM, adaptiveNote, checksPrompt, lessonPrompt } from "@/lib/ai/prompts";
import { formatSources, retrieve, type SourceRef } from "@/lib/rag/retrieve";
import { seededShuffle } from "@/lib/learning/grading";
import { numericString } from "./quiz";
import { getSettings } from "@/lib/settings";
import { logGeneration } from "./generations";
import { getTopic, recordEvent, topicSectionIds } from "./topics";

export type StreamEvent =
  | { type: "sources"; sources: SourceRef[]; mode: string }
  | { type: "text"; text: string }
  | { type: "meta"; [k: string]: unknown }
  | { type: "done"; id?: string }
  | { type: "error"; message: string };

export interface LessonRow {
  id: string;
  topic_id: string;
  content: string;
  sources: string;
  checks: string;
  model: string | null;
  created_at: string;
}

export interface KnowledgeCheck {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export function getLesson(topicId: string) {
  const r = db().prepare("SELECT * FROM lessons WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1").get(topicId) as LessonRow | undefined;
  if (!r) return null;
  return { ...r, sources: parseJson<SourceRef[]>(r.sources, []), checks: parseJson<KnowledgeCheck[]>(r.checks, []) };
}

export function getChat(topicId: string) {
  return (db().prepare("SELECT * FROM chat_messages WHERE topic_id = ? ORDER BY created_at").all(topicId) as {
    id: string;
    role: string;
    content: string;
    action: string | null;
    sources: string;
    generation_id: string | null;
    created_at: string;
  }[]).map((m) => ({ ...m, sources: parseJson<SourceRef[]>(m.sources, []) }));
}

export function clearChat(topicId: string) {
  db().prepare("DELETE FROM chat_messages WHERE topic_id = ?").run(topicId);
}

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

/** Stream a structured lesson; stored afterwards so it's never generated twice unless asked. */
export async function* streamLesson(topicId: string): AsyncGenerator<StreamEvent> {
  await requireChatModel();
  const ctx = await topicContext(topicId, ctx0(topicId), 7);
  if (!ctx.chunks.length) {
    yield { type: "error", message: "No course material found for this topic yet." };
    return;
  }
  yield { type: "sources", sources: ctx.refs, mode: ctx.mode };
  const prompt = lessonPrompt(ctx.topic, ctx.block);
  const llm = getLLM();
  const started = Date.now();
  let text = "";
  for await (const piece of llm.stream({ messages: [{ role: "system", content: TUTOR_SYSTEM }, { role: "user", content: prompt }], think: false })) {
    text += piece;
    yield { type: "text", text: piece };
  }
  const id = newId();
  db().prepare("INSERT INTO lessons (id, topic_id, content, sources, checks, model, created_at) VALUES (?,?,?,?,?,?,?)").run(id, topicId, text, JSON.stringify(ctx.refs), "[]", llm.model, nowIso());
  logGeneration({ task: "lesson", model: llm.model, prompt, output: text, durationMs: Date.now() - started, refId: id });
  recordActivity(ctx.topic.course_id, topicId);
  yield { type: "done", id };
}

function ctx0(topicId: string) {
  const t = getTopic(topicId);
  return t ? `${t.summary ?? ""} ${t.objectives.join(" ")}` : "";
}

function recordActivity(courseId: string, topicId: string) {
  // Lessons are activity, not evidence of mastery, so they're stored with kind 'lesson' and excluded from mastery.
  db().prepare("INSERT INTO learning_events (id, course_id, topic_id, kind, score, created_at) VALUES (?,?,?,?,?,?)").run(newId(), courseId, topicId, "lesson_view", 0, nowIso());
}

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
  const lesson = getLesson(topicId);
  if (lesson?.checks.length) return lesson.checks;
  await requireChatModel();
  const ctx = await topicContext(topicId, "key facts definitions", 5);
  const prompt = checksPrompt(ctx.block, ctx.topic.title);
  const started = Date.now();
  const res = await generateJson(checksSchema, { messages: [{ role: "system", content: TUTOR_SYSTEM }, { role: "user", content: prompt }], temperature: 0.3 });
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

/** Signals used to adapt teaching when a student is struggling. */
function struggleSignals(topicId: string) {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const wrong = (db()
    .prepare("SELECT COUNT(*) n FROM learning_events WHERE topic_id = ? AND kind IN ('check','quiz') AND score < 0.5 AND created_at >= ?")
    .get(topicId, since) as { n: number }).n;
  const msgs = db().prepare("SELECT action, strategy FROM chat_messages WHERE topic_id = ? AND created_at >= ? ORDER BY created_at").all(topicId, since) as {
    action: string | null;
    strategy: string | null;
  }[];
  return {
    wrongAnswers: wrong,
    simplerRequests: msgs.filter((m) => m.action === "simpler").length,
    usedStrategies: msgs.map((m) => m.strategy).filter((s): s is string => Boolean(s)),
  };
}

/** Chat with the tutor about a topic (free question or a quick action). */
export async function* streamTutorReply(opts: { topicId: string; message?: string; action?: string; socratic?: boolean }): AsyncGenerator<StreamEvent> {
  await requireChatModel();
  const quick = opts.action ? QUICK_ACTIONS[opts.action] : undefined;
  const userText = (quick ? quick.prompt : opts.message ?? "").trim().slice(0, 4000);
  if (!userText) {
    yield { type: "error", message: "Type a question first." };
    return;
  }
  const history = getChat(opts.topicId).slice(-8);
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const ctx = await topicContext(opts.topicId, `${opts.message ?? ""} ${quick ? lastUser : ""}`.trim(), 6);
  yield { type: "sources", sources: ctx.refs, mode: ctx.mode };

  const signals = struggleSignals(opts.topicId);
  const adapt = adaptiveNote(signals);
  if (adapt.strategy) yield { type: "meta", adaptive: true, strategy: adapt.strategy };

  const lesson = getLesson(opts.topicId);
  const system =
    TUTOR_SYSTEM +
    (opts.socratic ? SOCRATIC_ADDON : "") +
    `\n\nCurrent topic: "${ctx.topic.title}".${ctx.topic.objectives.length ? ` Objectives: ${ctx.topic.objectives.join("; ")}.` : ""}` +
    (lesson ? `\nThe student has read a lesson on this topic already.` : "") +
    adapt.note;

  const userMsgId = newId();
  db()
    .prepare("INSERT INTO chat_messages (id, topic_id, role, content, action, sources, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(userMsgId, opts.topicId, "user", quick ? quick.label : userText, opts.action ?? null, "[]", nowIso());

  const messages = [
    { role: "system" as const, content: system },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 2500) })),
    { role: "user" as const, content: `${ctx.block}\n\n${userText}` },
  ];
  const llm = getLLM();
  const started = Date.now();
  let text = "";
  for await (const piece of llm.stream({ messages, think: getSettings().thinking })) {
    text += piece;
    yield { type: "text", text: piece };
  }
  const genId = logGeneration({ task: "tutor", model: llm.model, prompt: JSON.stringify(messages), output: text, durationMs: Date.now() - started, refId: opts.topicId });
  const id = newId();
  db()
    .prepare("INSERT INTO chat_messages (id, topic_id, role, content, action, strategy, sources, generation_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, opts.topicId, "assistant", text, opts.action ?? null, adapt.strategy, JSON.stringify(ctx.refs), genId, nowIso());
  yield { type: "done", id };
}

/** Wrap an event generator as a streaming HTTP response (one JSON object per line). */
export function ndjsonResponse(gen: AsyncGenerator<StreamEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of gen) controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      } catch (e) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: (e as Error).message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
