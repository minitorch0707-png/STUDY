import "server-only";
import { z } from "zod";
import { db, newId, nowIso } from "@/lib/db";
import { generateJson, getLLM, requireChatModel } from "@/lib/ai";
import { TUTOR_SYSTEM, flashcardPrompt } from "@/lib/ai/prompts";
import { formatSources, retrieve } from "@/lib/rag/retrieve";
import { fingerprint, similarity } from "@/lib/learning/grading";
import { isMastered, previewIntervals, schedule, type Rating, type SrsCard } from "@/lib/learning/srs";
import { logGeneration, runInBackground } from "./generations";
import { getTopic, recordEvent, topicSectionIds } from "./topics";

export interface CardRow {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  chunk_id: string | null;
  state: SrsCard["state"];
  step: number;
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string;
}

const toSrs = (c: CardRow): SrsCard => ({ state: c.state, step: c.step, ease: c.ease, intervalDays: c.interval_days, reps: c.reps, lapses: c.lapses, dueAt: new Date(c.due_at) });

export function listDecks(courseId?: string) {
  const now = nowIso();
  return db()
    .prepare(
      `SELECT d.*, c.title course_title, c.color course_color, t.title topic_title,
        COUNT(k.id) card_count,
        SUM(CASE WHEN k.due_at <= ? THEN 1 ELSE 0 END) due_count,
        SUM(CASE WHEN k.state = 'new' THEN 1 ELSE 0 END) new_count,
        SUM(CASE WHEN k.state = 'review' AND k.interval_days >= 21 THEN 1 ELSE 0 END) mastered_count
       FROM decks d JOIN courses c ON c.id = d.course_id LEFT JOIN topics t ON t.id = d.topic_id LEFT JOIN cards k ON k.deck_id = d.id
       ${courseId ? "WHERE d.course_id = ?" : ""}
       GROUP BY d.id ORDER BY c.title, d.created_at DESC`,
    )
    .all(now, ...(courseId ? [courseId] : [])) as {
    id: string;
    course_id: string;
    topic_id: string | null;
    title: string;
    status: string;
    status_detail: string | null;
    course_title: string;
    course_color: string;
    topic_title: string | null;
    card_count: number;
    due_count: number;
    new_count: number;
    mastered_count: number;
  }[];
}

export function createDeck(courseId: string, title: string, topicId: string | null = null) {
  const id = newId();
  db().prepare("INSERT INTO decks (id, course_id, topic_id, title, status, created_at) VALUES (?,?,?,?, 'ready', ?)").run(id, courseId, topicId, title.trim().slice(0, 120) || "My cards", nowIso());
  return id;
}

export function addCard(deckId: string, front: string, back: string, chunkId: string | null = null) {
  const id = newId();
  const now = nowIso();
  db()
    .prepare("INSERT INTO cards (id, deck_id, front, back, chunk_id, state, due_at, created_at, updated_at) VALUES (?,?,?,?,?, 'new', ?, ?, ?)")
    .run(id, deckId, front.trim().slice(0, 1000), back.trim().slice(0, 2000), chunkId, now, now, now);
  return id;
}

export function updateCard(id: string, front: string, back: string) {
  db().prepare("UPDATE cards SET front = ?, back = ?, updated_at = ? WHERE id = ?").run(front.trim().slice(0, 1000), back.trim().slice(0, 2000), nowIso(), id);
}

export const deleteCard = (id: string) => db().prepare("DELETE FROM cards WHERE id = ?").run(id);
export const deleteDeck = (id: string) => db().prepare("DELETE FROM decks WHERE id = ?").run(id);

export function deckCards(deckId: string) {
  return db().prepare("SELECT * FROM cards WHERE deck_id = ? ORDER BY created_at").all(deckId) as CardRow[];
}

const cardsSchema = z.object({
  cards: z.array(z.object({ front: z.string().min(2).max(400), back: z.string().min(1).max(800), sourceId: z.string().nullable().optional() })).max(30),
});

/** Generate a deck for a topic from its source material (runs in background). */
export function generateDeck(topicId: string, count = 12) {
  const topic = getTopic(topicId);
  if (!topic) throw new Error("Topic not found");
  const existingDeck = db().prepare("SELECT id FROM decks WHERE topic_id = ? ORDER BY created_at LIMIT 1").get(topicId) as { id: string } | undefined;
  const deckId = existingDeck?.id ?? newId();
  if (!existingDeck) db().prepare("INSERT INTO decks (id, course_id, topic_id, title, status, created_at) VALUES (?,?,?,?, 'generating', ?)").run(deckId, topic.course_id, topicId, topic.title, nowIso());
  else db().prepare("UPDATE decks SET status = 'generating', status_detail = NULL WHERE id = ?").run(deckId);

  runInBackground("flashcards", async () => {
    try {
      await requireChatModel();
      const { chunks } = await retrieve({ courseId: topic.course_id, query: `${topic.title} ${topic.keywords.join(" ")} definitions key points`, preferSectionIds: topicSectionIds(topicId), limit: 6 });
      if (!chunks.length) throw new Error("No material found for this topic.");
      const { block } = formatSources(chunks);
      const existing = deckCards(deckId);
      const prompt = flashcardPrompt(block, topic.title, count, existing.slice(-30).map((c) => c.front));
      const started = Date.now();
      const res = await generateJson(cardsSchema, { messages: [{ role: "system", content: TUTOR_SYSTEM }, { role: "user", content: prompt }], temperature: 0.4 });
      logGeneration({ task: "flashcards", model: getLLM().model, prompt, output: JSON.stringify(res), durationMs: Date.now() - started, refId: deckId });
      const fps = existing.map((c) => fingerprint(c.front));
      let added = 0;
      for (const c of res.cards) {
        const fp = fingerprint(c.front);
        if (fps.some((f) => similarity(f, fp) >= 0.8)) continue;
        const n = Number(/S?(\d+)/.exec(c.sourceId ?? "")?.[1] ?? 0);
        addCard(deckId, c.front, c.back, chunks[n - 1]?.chunkId ?? null);
        fps.push(fp);
        added++;
      }
      db().prepare("UPDATE decks SET status = 'ready', status_detail = ? WHERE id = ?").run(added ? null : "No new cards were created (all were duplicates).", deckId);
    } catch (e) {
      db().prepare("UPDATE decks SET status = ?, status_detail = ? WHERE id = ?").run(existingDeck ? "ready" : "failed", (e as Error).message.slice(0, 400), deckId);
    }
  });
  return deckId;
}

/** Cards to review: due first (oldest first), then up to `newLimit` new cards. */
export function reviewQueue(opts: { courseId?: string; deckId?: string; topicId?: string; includeNotDue?: boolean; newLimit?: number; limit?: number }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.deckId) {
    where.push("k.deck_id = ?");
    args.push(opts.deckId);
  }
  if (opts.courseId) {
    where.push("d.course_id = ?");
    args.push(opts.courseId);
  }
  if (opts.topicId) {
    where.push("d.topic_id = ?");
    args.push(opts.topicId);
  }
  const base = `SELECT k.*, d.title deck_title, d.topic_id, c.title course_title, c.color course_color,
    s.label source_label, doc.display_name source_document, doc.id source_document_id, s.idx source_section_idx
    FROM cards k JOIN decks d ON d.id = k.deck_id JOIN courses c ON c.id = d.course_id
    LEFT JOIN chunks ch ON ch.id = k.chunk_id LEFT JOIN sections s ON s.id = ch.section_id LEFT JOIN documents doc ON doc.id = ch.document_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const now = nowIso();
  type Row = CardRow & Record<string, unknown>;
  let rows: Row[];
  if (opts.includeNotDue) {
    rows = db().prepare(`${base} ORDER BY k.due_at LIMIT ?`).all(...args, opts.limit ?? 200) as Row[];
  } else {
    const due = db().prepare(`${base} ${where.length ? "AND" : "WHERE"} k.state != 'new' AND k.due_at <= ? ORDER BY k.due_at LIMIT ?`).all(...args, now, opts.limit ?? 200) as Row[];
    const fresh = db().prepare(`${base} ${where.length ? "AND" : "WHERE"} k.state = 'new' ORDER BY k.created_at LIMIT ?`).all(...args, opts.newLimit ?? 20) as Row[];
    rows = [...due, ...fresh];
  }
  return rows.map((r) => ({ ...r, preview: previewIntervals(toSrs(r)) }));
}

export function reviewCard(cardId: string, rating: Rating, durationMs?: number) {
  const card = db().prepare("SELECT k.*, d.course_id, d.topic_id FROM cards k JOIN decks d ON d.id = k.deck_id WHERE k.id = ?").get(cardId) as
    | (CardRow & { course_id: string; topic_id: string | null })
    | undefined;
  if (!card) throw new Error("Card not found");
  const now = new Date();
  const next = schedule(toSrs(card), rating, now);
  db().transaction(() => {
    db()
      .prepare("UPDATE cards SET state=?, step=?, ease=?, interval_days=?, reps=?, lapses=?, due_at=?, updated_at=? WHERE id=?")
      .run(next.state, next.step, next.ease, next.intervalDays, next.reps, next.lapses, next.dueAt.toISOString(), now.toISOString(), cardId);
    db()
      .prepare("INSERT INTO reviews (id, card_id, rating, reviewed_at, prev_interval, new_interval, duration_ms) VALUES (?,?,?,?,?,?,?)")
      .run(newId(), cardId, rating, now.toISOString(), card.interval_days, next.intervalDays, durationMs ?? null);
    // Again = forgot (0), Hard = shaky (0.6), Good/Easy = remembered (1).
    if (card.topic_id) recordEvent({ courseId: card.course_id, topicId: card.topic_id, kind: "flashcard", score: rating === 1 ? 0 : rating === 2 ? 0.6 : 1, refId: cardId });
  })();
  return { ...next, mastered: isMastered(next) };
}
