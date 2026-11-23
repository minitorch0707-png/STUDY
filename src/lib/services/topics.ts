import "server-only";
import { z } from "zod";
import { db, newId, nowIso, parseJson } from "@/lib/db";
import { generateJson, getLLM, getStatus } from "@/lib/ai";
import { topicPrompt } from "@/lib/ai/prompts";
import { sanitizeSourceText, truncate } from "@/lib/ai/text";
import { fingerprint, similarity } from "@/lib/learning/grading";
import { estimateMastery, type MasteryEstimate } from "@/lib/learning/mastery";
import { logGeneration } from "./generations";

export interface Topic {
  id: string;
  course_id: string;
  document_id: string | null;
  title: string;
  summary: string | null;
  objectives: string[];
  keywords: string[];
  importance: number;
  ord: number;
}

interface TopicRow extends Omit<Topic, "objectives" | "keywords"> {
  objectives: string;
  keywords: string;
}

const hydrate = (r: TopicRow): Topic => ({ ...r, objectives: parseJson(r.objectives, []), keywords: parseJson(r.keywords, []) });

export function getTopic(id: string): Topic | null {
  const r = db().prepare("SELECT * FROM topics WHERE id = ?").get(id) as TopicRow | undefined;
  return r ? hydrate(r) : null;
}

export function topicSectionIds(topicId: string): string[] {
  return (db().prepare("SELECT section_id FROM topic_sections WHERE topic_id = ?").all(topicId) as { section_id: string }[]).map((r) => r.section_id);
}

export function topicSections(topicId: string) {
  return db()
    .prepare(
      `SELECT s.id, s.idx, s.label, s.title, d.id document_id, d.display_name, d.ext FROM topic_sections ts
       JOIN sections s ON s.id = ts.section_id JOIN documents d ON d.id = s.document_id
       WHERE ts.topic_id = ? ORDER BY d.created_at, s.idx`,
    )
    .all(topicId) as { id: string; idx: number; label: string; title: string | null; document_id: string; display_name: string; ext: string }[];
}

export function topicMastery(topicId: string, now = new Date()): MasteryEstimate {
  const ev = db().prepare("SELECT score, kind, created_at FROM learning_events WHERE topic_id = ? AND kind IN ('quiz','check','flashcard') ORDER BY created_at").all(topicId) as {
    score: number;
    kind: string;
    created_at: string;
  }[];
  return estimateMastery(ev.map((e) => ({ score: e.score, kind: e.kind, at: new Date(e.created_at) })), now);
}

export function listTopics(courseId: string) {
  const rows = db()
    .prepare(
      `SELECT t.*, d.display_name document_name, d.week week FROM topics t LEFT JOIN documents d ON d.id = t.document_id
       WHERE t.course_id = ? ORDER BY COALESCE(d.week, 999), d.created_at, t.ord`,
    )
    .all(courseId) as (TopicRow & { document_name: string | null; week: number | null })[];
  return rows.map((r) => ({ ...hydrate(r), document_name: r.document_name, week: r.week, mastery: topicMastery(r.id) }));
}

const topicSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(2).max(120),
        summary: z.string().max(600).default(""),
        objectives: z.array(z.string().max(250)).max(6).default([]),
        keywords: z.array(z.string().max(60)).max(8).default([]),
        sections: z.array(z.number().int()).max(80).default([]),
        importance: z.number().int().min(1).max(3).default(2),
      }),
    )
    .max(12),
});

/**
 * Find topics in a document. Uses the local model when available; otherwise
 * builds a basic outline from the document's own headings (clearly labelled).
 * Returns a warning string if the result is limited.
 */
export async function extractTopicsForDocument(documentId: string, opts: { replace?: boolean } = {}): Promise<string | null> {
  const doc = db().prepare("SELECT id, course_id, display_name, kind FROM documents WHERE id = ?").get(documentId) as
    | { id: string; course_id: string; display_name: string; kind: string }
    | undefined;
  if (!doc) return null;
  const sections = db().prepare("SELECT id, idx, label, title, content FROM sections WHERE document_id = ? AND has_text = 1 ORDER BY idx").all(documentId) as {
    id: string;
    idx: number;
    label: string;
    title: string | null;
    content: string;
  }[];
  if (!sections.length) return null;
  if (opts.replace) db().prepare("DELETE FROM topics WHERE document_id = ?").run(documentId);

  const status = await getStatus();
  const canUseAI = status.reachable && status.chatModel.installed;

  type Found = { title: string; summary: string; objectives: string[]; keywords: string[]; sectionIds: string[]; importance: number };
  let found: Found[] = [];
  let warning: string | null = null;

  if (canUseAI) {
    const byIdx = new Map(sections.map((s) => [s.idx, s]));
    const windowSize = 40;
    for (let start = 0; start < sections.length; start += windowSize) {
      const win = sections.slice(start, start + windowSize);
      const outline = win
        .map((s) => `[${s.idx}] ${s.label}: ${s.title ?? "(untitled)"} — ${truncate(s.content.replace(/\s+/g, " "), 220)}`)
        .map(sanitizeSourceText)
        .join("\n");
      const maxTopics = Math.min(8, Math.max(2, Math.ceil(win.length / 4)));
      const prompt = topicPrompt(doc.display_name, outline, maxTopics);
      const started = Date.now();
      try {
        const res = await generateJson(topicSchema, { messages: [{ role: "user", content: prompt }], temperature: 0.2 });
        logGeneration({ task: "topics", model: getLLM().model, prompt, output: JSON.stringify(res), durationMs: Date.now() - started, refId: documentId });
        for (const t of res.topics) {
          const ids = t.sections.map((n) => byIdx.get(n)?.id).filter((x): x is string => Boolean(x));
          found.push({ title: t.title.trim(), summary: t.summary, objectives: t.objectives, keywords: t.keywords, sectionIds: ids, importance: t.importance });
        }
      } catch (e) {
        warning = `AI topic analysis had a problem (${(e as Error).message.slice(0, 120)}); a basic outline was used for part of this file.`;
        found.push(...headingOutline(win));
      }
    }
  } else {
    found = headingOutline(sections);
    warning = "Topics were built from the document's headings because the AI model wasn't available. Use Re-analyse once Ollama is running for better topics.";
  }

  if (doc.kind === "syllabus") return warning; // syllabi describe the course; topics come from lectures

  // Merge with similar topics already in the course (e.g. same concept in two lectures).
  const existing = db().prepare("SELECT id, title FROM topics WHERE course_id = ?").all(doc.course_id) as { id: string; title: string }[];
  const insTopic = db().prepare(
    "INSERT INTO topics (id, course_id, document_id, title, summary, objectives, keywords, importance, ord, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  const link = db().prepare("INSERT OR IGNORE INTO topic_sections (topic_id, section_id) VALUES (?, ?)");
  db().transaction(() => {
    found.forEach((t, i) => {
      const fp = fingerprint(t.title);
      const match = existing.find((e) => similarity(fingerprint(e.title), fp) >= 0.75);
      const id = match?.id ?? newId();
      if (!match) {
        insTopic.run(id, doc.course_id, documentId, t.title, t.summary || null, JSON.stringify(t.objectives), JSON.stringify(t.keywords), t.importance, i, nowIso());
        existing.push({ id, title: t.title });
      }
      for (const sid of t.sectionIds) link.run(id, sid);
    });
  })();
  return warning;
}

function headingOutline(sections: { id: string; idx: number; title: string | null; content: string }[]) {
  const out: { title: string; summary: string; objectives: string[]; keywords: string[]; sectionIds: string[]; importance: number }[] = [];
  for (const s of sections) {
    const title = s.title?.trim();
    if (!title || title.length < 3 || /^(agenda|outline|overview|questions\??|references|thank you|contents)$/i.test(title)) {
      if (out.length) out[out.length - 1].sectionIds.push(s.id);
      continue;
    }
    const prev = out[out.length - 1];
    // Only merge continuation slides ("Causation (cont.)"), not merely related titles.
    if (prev && similarity(fingerprint(prev.title), fingerprint(title.replace(/\(?cont(inued|'d|\.)?\)?/i, ""))) >= 0.8) {
      prev.sectionIds.push(s.id);
      continue;
    }
    out.push({ title, summary: truncate(s.content.replace(/\s+/g, " "), 200), objectives: [], keywords: [], sectionIds: [s.id], importance: 2 });
  }
  return out.slice(0, 30);
}

export function updateTopic(id: string, patch: { title?: string; importance?: number }) {
  const t = getTopic(id);
  if (!t) return null;
  db().prepare("UPDATE topics SET title = ?, importance = ? WHERE id = ?").run(patch.title?.trim() || t.title, patch.importance ?? t.importance, id);
  return getTopic(id);
}

export function deleteTopic(id: string) {
  db().prepare("DELETE FROM topics WHERE id = ?").run(id);
}

export function recordEvent(e: { courseId: string; topicId: string | null; kind: string; score: number; refId?: string }) {
  db()
    .prepare("INSERT INTO learning_events (id, course_id, topic_id, kind, score, ref_id, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(newId(), e.courseId, e.topicId, e.kind, Math.max(0, Math.min(1, e.score)), e.refId ?? null, nowIso());
}
