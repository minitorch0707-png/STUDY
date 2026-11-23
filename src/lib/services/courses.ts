import "server-only";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { db, newId, nowIso, UPLOAD_DIR } from "@/lib/db";

export const COURSE_COLORS = ["indigo", "violet", "rose", "amber", "emerald", "sky", "teal", "slate"] as const;

export const courseInput = z.object({
  title: z.string().trim().min(1, "Give your course a name").max(120),
  code: z.string().trim().max(30).optional().nullable(),
  semester: z.string().trim().max(40).optional().nullable(),
  professor: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  color: z.enum(COURSE_COLORS).optional(),
});

export interface Course {
  id: string;
  title: string;
  code: string | null;
  semester: string | null;
  professor: string | null;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface CourseSummary extends Course {
  document_count: number;
  topic_count: number;
  card_count: number;
  due_cards: number;
  next_exam: { title: string; date: string } | null;
  processing: number;
}

export function listCourses(): CourseSummary[] {
  const now = nowIso();
  const today = now.slice(0, 10);
  const rows = db()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM documents d WHERE d.course_id = c.id) document_count,
        (SELECT COUNT(*) FROM documents d WHERE d.course_id = c.id AND d.status NOT IN ('ready','failed')) processing,
        (SELECT COUNT(*) FROM topics t WHERE t.course_id = c.id) topic_count,
        (SELECT COUNT(*) FROM cards k JOIN decks dk ON dk.id = k.deck_id WHERE dk.course_id = c.id) card_count,
        (SELECT COUNT(*) FROM cards k JOIN decks dk ON dk.id = k.deck_id WHERE dk.course_id = c.id AND k.due_at <= ?) due_cards,
        (SELECT json_object('title', e.title, 'date', e.date) FROM calendar_events e WHERE e.course_id = c.id AND e.kind = 'exam' AND e.confirmed = 1 AND e.date >= ? ORDER BY e.date LIMIT 1) next_exam
       FROM courses c ORDER BY c.updated_at DESC`,
    )
    .all(now, today) as (Omit<CourseSummary, "next_exam"> & { next_exam: string | null })[];
  return rows.map((r) => ({ ...r, next_exam: r.next_exam ? JSON.parse(r.next_exam) : null }));
}

export function getCourse(id: string): Course | null {
  return (db().prepare("SELECT * FROM courses WHERE id = ?").get(id) as Course | undefined) ?? null;
}

export function createCourse(input: z.infer<typeof courseInput>): Course {
  const id = newId();
  const now = nowIso();
  const used = new Set((db().prepare("SELECT color FROM courses").all() as { color: string }[]).map((r) => r.color));
  const color = input.color ?? COURSE_COLORS.find((c) => !used.has(c)) ?? "indigo";
  db()
    .prepare("INSERT INTO courses (id, title, code, semester, professor, description, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, input.title, input.code || null, input.semester || null, input.professor || null, input.description || null, color, now, now);
  return getCourse(id)!;
}

export function updateCourse(id: string, input: Partial<z.infer<typeof courseInput>>): Course | null {
  const c = getCourse(id);
  if (!c) return null;
  const merged = { ...c, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  db()
    .prepare("UPDATE courses SET title=?, code=?, semester=?, professor=?, description=?, color=?, updated_at=? WHERE id=?")
    .run(merged.title, merged.code || null, merged.semester || null, merged.professor || null, merged.description || null, merged.color, nowIso(), id);
  return getCourse(id);
}

export function touchCourse(id: string) {
  db().prepare("UPDATE courses SET updated_at = ? WHERE id = ?").run(nowIso(), id);
}

export function deleteCourse(id: string) {
  db().prepare("DELETE FROM courses WHERE id = ?").run(id);
  if (/^[0-9a-f-]{36}$/.test(id)) fs.rmSync(path.join(UPLOAD_DIR, id), { recursive: true, force: true });
}
