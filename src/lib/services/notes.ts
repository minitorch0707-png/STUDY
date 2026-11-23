import "server-only";
import { db, newId, nowIso, parseJson } from "@/lib/db";
import { getLLM, getStatus } from "@/lib/ai";
import { notesPrompt } from "@/lib/ai/prompts";
import { truncate } from "@/lib/ai/text";
import { getSettings } from "@/lib/settings";
import { logEvent } from "@/lib/logs";
import type { SourceRef } from "@/lib/rag/retrieve";
import { logGeneration } from "./generations";
import { getTopic } from "./topics";

/**
 * Study notes. Each topic has one "auto" note that LectureLab keeps up to date
 * from the tutor conversation (a short while after the student stops chatting).
 * The AI merges new material into the existing note and keeps the student's
 * own edits. Students can also write their own notes or save single answers.
 */

export interface Note {
  id: string;
  course_id: string;
  topic_id: string | null;
  title: string;
  content: string;
  kind: "auto" | "manual";
  synced_until: string | null;
  created_at: string;
  updated_at: string;
}

const g = globalThis as unknown as { __llNoteTimers?: Map<string, ReturnType<typeof setTimeout>>; __llNotesBusy?: Set<string> };
const timers = (g.__llNoteTimers ??= new Map());
const busy = (g.__llNotesBusy ??= new Set());
export const AUTO_NOTES_DELAY_MS = 45_000;

export function listNotes(opts: { courseId?: string; q?: string } = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.courseId) {
    where.push("n.course_id = ?");
    args.push(opts.courseId);
  }
  if (opts.q?.trim()) {
    where.push("(n.title LIKE ? OR n.content LIKE ?)");
    const q = `%${opts.q.trim().replace(/[%_]/g, "")}%`;
    args.push(q, q);
  }
  const rows = db()
    .prepare(
      `SELECT n.*, c.title course_title, c.color course_color, t.title topic_title FROM notes n
       JOIN courses c ON c.id = n.course_id LEFT JOIN topics t ON t.id = n.topic_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY n.updated_at DESC LIMIT 300`,
    )
    .all(...args) as (Note & { course_title: string; course_color: string; topic_title: string | null })[];
  return rows.map((r) => ({ ...r, preview: truncate(r.content.replace(/[#*>`_-]/g, "").replace(/\s+/g, " ").trim(), 140), updating: r.topic_id ? busy.has(r.topic_id) : false }));
}

export function getNote(id: string) {
  const n = db().prepare("SELECT n.*, c.title course_title, t.title topic_title FROM notes n JOIN courses c ON c.id = n.course_id LEFT JOIN topics t ON t.id = n.topic_id WHERE n.id = ?").get(id) as
    | (Note & { course_title: string; topic_title: string | null })
    | undefined;
  return n ? { ...n, updating: n.topic_id ? busy.has(n.topic_id) : false } : null;
}

export function topicNote(topicId: string) {
  const n = db().prepare("SELECT * FROM notes WHERE topic_id = ? AND kind = 'auto'").get(topicId) as Note | undefined;
  return { note: n ?? null, updating: busy.has(topicId), autoNotes: getSettings().autoNotes };
}

export function createNote(input: { courseId: string; title: string; content?: string; topicId?: string | null }) {
  const id = newId();
  const now = nowIso();
  db()
    .prepare("INSERT INTO notes (id, course_id, topic_id, title, content, kind, created_at, updated_at) VALUES (?,?,?,?,?, 'manual', ?, ?)")
    .run(id, input.courseId, input.topicId ?? null, input.title.trim().slice(0, 200) || "Untitled note", input.content ?? "", now, now);
  return getNote(id)!;
}

export function updateNote(id: string, patch: { title?: string; content?: string }) {
  const n = getNote(id);
  if (!n) return null;
  db()
    .prepare("UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?")
    .run((patch.title ?? n.title).trim().slice(0, 200) || n.title, (patch.content ?? n.content).slice(0, 200_000), nowIso(), id);
  return getNote(id);
}

export const deleteNote = (id: string) => db().prepare("DELETE FROM notes WHERE id = ?").run(id);

function ensureAutoNote(topicId: string): Note {
  const existing = db().prepare("SELECT * FROM notes WHERE topic_id = ? AND kind = 'auto'").get(topicId) as Note | undefined;
  if (existing) return existing;
  const topic = getTopic(topicId);
  if (!topic) throw new Error("Topic not found");
  const id = newId();
  const now = nowIso();
  db()
    .prepare("INSERT INTO notes (id, course_id, topic_id, title, content, kind, created_at, updated_at) VALUES (?,?,?,?, '', 'auto', ?, ?)")
    .run(id, topic.course_id, topicId, topic.title, now, now);
  return db().prepare("SELECT * FROM notes WHERE id = ?").get(id) as Note;
}

/** Replace [S2] citations with readable references, since note text outlives the chat's source list. */
export function readableCitations(text: string, sources: SourceRef[]) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  return text.replace(/\[S(\d+)\]/g, (m, n) => {
    const s = byN.get(Number(n));
    return s ? `(${s.sectionLabel}, ${s.documentName})` : "";
  });
}

/** One click: append a tutor answer to the topic's notes (no AI needed). */
export function saveMessageToNotes(topicId: string, messageId: string) {
  const msg = db().prepare("SELECT content, sources, action, created_at FROM chat_messages WHERE id = ? AND topic_id = ?").get(messageId, topicId) as
    | { content: string; sources: string; action: string | null; created_at: string }
    | undefined;
  if (!msg) throw new Error("Message not found");
  const question = db()
    .prepare("SELECT content FROM chat_messages WHERE topic_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC LIMIT 1")
    .get(topicId, msg.created_at) as { content: string } | undefined;
  const note = ensureAutoNote(topicId);
  const body = readableCitations(msg.content, parseJson<SourceRef[]>(msg.sources, [])).trim();
  const block = `\n\n### Saved: ${truncate(question?.content ?? "Tutor answer", 80)}\n\n${body}\n`;
  return updateNote(note.id, { content: (note.content + block).trim() })!;
}

function transcriptSince(topicId: string, since: string | null) {
  const msgs = db()
    .prepare(`SELECT role, content, sources, created_at FROM chat_messages WHERE topic_id = ? ${since ? "AND created_at > ?" : ""} ORDER BY created_at`)
    .all(...(since ? [topicId, since] : [topicId])) as { role: string; content: string; sources: string; created_at: string }[];
  return {
    msgs,
    text: msgs
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${readableCitations(m.content, parseJson<SourceRef[]>(m.sources, [])).slice(0, 3000)}`)
      .join("\n\n"),
  };
}

/** Fold new conversation into the topic's notes (AI), or append it as-is if the AI isn't available. */
export async function refreshTopicNotes(topicId: string): Promise<Note | null> {
  if (busy.has(topicId)) return null;
  busy.add(topicId);
  try {
    const topic = getTopic(topicId);
    if (!topic) return null;
    const note = ensureAutoNote(topicId);
    const { msgs, text } = transcriptSince(topicId, note.synced_until);
    const lesson = !note.content
      ? (db().prepare("SELECT content, sources FROM lessons WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1").get(topicId) as { content: string; sources: string } | undefined)
      : undefined;
    if (!msgs.length && !lesson) return note;
    const lastAt = msgs.at(-1)?.created_at ?? nowIso();
    const lessonText = lesson ? readableCitations(lesson.content, parseJson<SourceRef[]>(lesson.sources, [])).slice(0, 6000) : undefined;

    const st = await getStatus();
    let content: string;
    if (st.reachable && st.chatModel.installed) {
      const prompt = notesPrompt({ topicTitle: topic.title, existing: note.content, transcript: text.slice(-14_000) || "(no conversation yet)", lesson: lessonText });
      const started = Date.now();
      const res = await getLLM().chat({ messages: [{ role: "user", content: prompt }], temperature: 0.2, think: false, maxTokens: 1400 });
      content = res.text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
      logGeneration({ task: "notes", model: res.model, prompt, output: content, durationMs: Date.now() - started, refId: note.id });
      if (content.length < 40) throw new Error("The AI returned empty notes");
    } else {
      // No AI right now: keep the conversation itself so nothing is lost.
      content = `${note.content}\n\n## Conversation (${new Date().toLocaleDateString()})\n\n${text}`.trim();
    }
    db().prepare("UPDATE notes SET content = ?, synced_until = ?, updated_at = ? WHERE id = ?").run(content, lastAt, nowIso(), note.id);
    return db().prepare("SELECT * FROM notes WHERE id = ?").get(note.id) as Note;
  } catch (e) {
    logEvent("warn", "notes", `Couldn't update notes: ${(e as Error).message}`);
    return null;
  } finally {
    busy.delete(topicId);
  }
}

/** Called after each tutor reply: update notes once the student pauses. */
export function scheduleAutoNotes(topicId: string, delayMs = AUTO_NOTES_DELAY_MS) {
  if (!getSettings().autoNotes) return;
  const t = timers.get(topicId);
  if (t) clearTimeout(t);
  timers.set(
    topicId,
    setTimeout(() => {
      timers.delete(topicId);
      void refreshTopicNotes(topicId);
    }, delayMs),
  );
}
