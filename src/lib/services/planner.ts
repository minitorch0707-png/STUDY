import "server-only";
import { db, newId, nowIso, parseJson } from "@/lib/db";
import { buildPlan } from "@/lib/learning/planner";
import { listTopics } from "./topics";

export function listCalendar(opts: { courseId?: string; includeUnconfirmed?: boolean } = {}) {
  return db()
    .prepare(
      `SELECT e.*, c.title course_title, c.color course_color, d.display_name source_document FROM calendar_events e
       JOIN courses c ON c.id = e.course_id LEFT JOIN documents d ON d.id = e.source_document_id
       WHERE 1=1 ${opts.courseId ? "AND e.course_id = ?" : ""} ${opts.includeUnconfirmed ? "" : "AND e.confirmed = 1"} ORDER BY e.date`,
    )
    .all(...(opts.courseId ? [opts.courseId] : [])) as {
    id: string;
    course_id: string;
    title: string;
    kind: string;
    date: string;
    weight: number | null;
    confirmed: number;
    source_text: string | null;
    source_document: string | null;
    course_title: string;
    course_color: string;
  }[];
}

export function addEvent(e: { courseId: string; title: string; kind: string; date: string; weight?: number | null }) {
  const id = newId();
  db()
    .prepare("INSERT INTO calendar_events (id, course_id, title, kind, date, weight, confirmed, created_at) VALUES (?,?,?,?,?,?,1,?)")
    .run(id, e.courseId, e.title.trim().slice(0, 120), e.kind, e.date, e.weight ?? null, nowIso());
  return id;
}

export function updateEvent(id: string, patch: { title?: string; kind?: string; date?: string; weight?: number | null; confirmed?: boolean }) {
  const cur = db().prepare("SELECT * FROM calendar_events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!cur) return;
  db()
    .prepare("UPDATE calendar_events SET title = ?, kind = ?, date = ?, weight = ?, confirmed = ? WHERE id = ?")
    .run(patch.title ?? cur.title, patch.kind ?? cur.kind, patch.date ?? cur.date, patch.weight === undefined ? cur.weight : patch.weight, patch.confirmed === undefined ? cur.confirmed : patch.confirmed ? 1 : 0, id);
}

export const deleteEvent = (id: string) => db().prepare("DELETE FROM calendar_events WHERE id = ?").run(id);

export function createPlan(opts: { courseId: string; examDate: string; dailyMinutes: number; examEventId?: string | null; topicIds?: string[]; cram?: boolean }) {
  const topics = listTopics(opts.courseId)
    .filter((t) => !opts.topicIds?.length || opts.topicIds.includes(t.id))
    .map((t) => ({ id: t.id, title: t.title, importance: t.importance, mastery: t.mastery.mastery, attempts: t.mastery.attempts }));
  if (!topics.length) throw new Error("This course has no topics yet — upload lecture material first.");
  const todayIso = nowIso().slice(0, 10);
  const plan = buildPlan({ today: todayIso, examDate: opts.examDate, dailyMinutes: opts.dailyMinutes, topics, forceCram: opts.cram });
  if (!plan.items.length) throw new Error(plan.notes[0] ?? "Couldn't build a plan.");
  const id = newId();
  db().transaction(() => {
    // One active plan per course + exam date.
    db().prepare("DELETE FROM study_plans WHERE course_id = ? AND exam_date = ?").run(opts.courseId, opts.examDate);
    db()
      .prepare("INSERT INTO study_plans (id, course_id, exam_event_id, exam_date, daily_minutes, cram, notes, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, opts.courseId, opts.examEventId ?? null, opts.examDate, opts.dailyMinutes, plan.cram ? 1 : 0, JSON.stringify({ notes: plan.notes, skipped: plan.skippedTopics }), nowIso());
    const ins = db().prepare("INSERT INTO plan_items (id, plan_id, date, kind, topic_id, title, minutes) VALUES (?,?,?,?,?,?,?)");
    for (const it of plan.items) ins.run(newId(), id, it.date, it.kind, it.topicId, it.title, it.minutes);
  })();
  return id;
}

export function listPlans() {
  const plans = db()
    .prepare(
      `SELECT p.*, c.title course_title, c.color course_color, e.title exam_title FROM study_plans p JOIN courses c ON c.id = p.course_id
       LEFT JOIN calendar_events e ON e.id = p.exam_event_id ORDER BY p.exam_date`,
    )
    .all() as { id: string; course_id: string; exam_date: string; daily_minutes: number; cram: number; notes: string; course_title: string; course_color: string; exam_title: string | null }[];
  const items = db().prepare("SELECT * FROM plan_items WHERE plan_id = ? ORDER BY date, kind = 'flashcards' DESC");
  return plans.map((p) => ({
    ...p,
    notes: parseJson<{ notes: string[]; skipped: string[] }>(p.notes, { notes: [], skipped: [] }),
    items: items.all(p.id) as { id: string; date: string; kind: string; topic_id: string | null; title: string; minutes: number; done: number }[],
  }));
}

export const setPlanItemDone = (id: string, done: boolean) => db().prepare("UPDATE plan_items SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
export const deletePlan = (id: string) => db().prepare("DELETE FROM study_plans WHERE id = ?").run(id);
