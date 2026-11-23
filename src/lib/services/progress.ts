import "server-only";
import { db, nowIso } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/learning/mastery";
import { listTopics } from "./topics";

export type Recommendation = {
  id: string;
  kind: "relearn" | "flashcards" | "quiz" | "start" | "exam" | "plan" | "upload";
  title: string;
  reason: string;
  href: string;
  priority: number;
};

const today = () => nowIso().slice(0, 10);

export function upcomingEvents(limit = 10, courseId?: string) {
  return db()
    .prepare(
      `SELECT e.*, c.title course_title, c.color course_color FROM calendar_events e JOIN courses c ON c.id = e.course_id
       WHERE e.confirmed = 1 AND e.date >= ? ${courseId ? "AND e.course_id = ?" : ""} ORDER BY e.date LIMIT ?`,
    )
    .all(today(), ...(courseId ? [courseId] : []), limit) as {
    id: string;
    course_id: string;
    title: string;
    kind: string;
    date: string;
    weight: number | null;
    course_title: string;
    course_color: string;
  }[];
}

function allTopics() {
  const courses = db().prepare("SELECT id, title, color FROM courses").all() as { id: string; title: string; color: string }[];
  return courses.flatMap((c) => listTopics(c.id).map((t) => ({ ...t, course_title: c.title, course_color: c.color })));
}

/**
 * The recommendation engine: simple, transparent rules that connect lessons,
 * quizzes, flashcards and the planner. Each recommendation says WHY.
 */
export function recommendations(limit = 6): Recommendation[] {
  const recs: Recommendation[] = [];
  const topics = allTopics();
  const courseCount = (db().prepare("SELECT COUNT(*) n FROM courses").get() as { n: number }).n;
  if (!courseCount) return [{ id: "create", kind: "upload", title: "Create your first course", reason: "Add a course and upload your lecture slides to get started.", href: "/courses?new=1", priority: 100 }];
  const docCount = (db().prepare("SELECT COUNT(*) n FROM documents").get() as { n: number }).n;
  if (!docCount) {
    const c = db().prepare("SELECT id FROM courses ORDER BY created_at LIMIT 1").get() as { id: string };
    recs.push({ id: "upload", kind: "upload", title: "Upload your course materials", reason: "LectureLab builds lessons, quizzes and flashcards from your own files.", href: `/courses/${c.id}`, priority: 100 });
  }

  // 1. Weak topics → re-learn with a different explanation + targeted practice.
  for (const t of topics.filter((t) => t.mastery.status === "weak").sort((a, b) => a.mastery.mastery - b.mastery.mastery).slice(0, 3)) {
    recs.push({
      id: `weak-${t.id}`,
      kind: "relearn",
      title: `Revisit “${t.title}”`,
      reason: `You've been getting this wrong (${Math.round(t.mastery.mastery * 100)}% estimated mastery from ${t.mastery.attempts} answers). Try a fresh explanation, then quiz yourself.`,
      href: `/tutor/${t.id}?adaptive=1`,
      priority: 90 + t.importance,
    });
  }

  // 2. Due flashcards.
  const due = (db().prepare("SELECT COUNT(*) n FROM cards WHERE due_at <= ? AND state != 'new'").get(nowIso()) as { n: number }).n;
  if (due) recs.push({ id: "due", kind: "flashcards", title: `Review ${due} due flashcard${due === 1 ? "" : "s"}`, reason: "Reviewing right when cards are due is what makes spaced repetition work.", href: "/flashcards/review", priority: 85 });

  // 3. Upcoming exam soon.
  const exam = upcomingEvents(5).find((e) => e.kind === "exam");
  if (exam) {
    const days = Math.round((new Date(exam.date).getTime() - new Date(today()).getTime()) / 86_400_000);
    const hasPlan = db().prepare("SELECT 1 FROM study_plans WHERE course_id = ? AND exam_date = ?").get(exam.course_id, exam.date);
    if (!hasPlan && days <= 30)
      recs.push({ id: `plan-${exam.id}`, kind: "plan", title: `Make a study plan for ${exam.title}`, reason: `${exam.course_title} — ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}.`, href: `/planner?exam=${exam.id}`, priority: 80 + Math.max(0, 30 - days) / 3 });
  }

  // 4. Developing topics → practice quiz.
  for (const t of topics.filter((t) => t.mastery.status === "developing").slice(0, 2)) {
    recs.push({ id: `dev-${t.id}`, kind: "quiz", title: `Practise “${t.title}”`, reason: `You're ${STATUS_LABEL.developing.toLowerCase()} (${Math.round(t.mastery.mastery * 100)}%). A short quiz will lock it in.`, href: `/exams/new?course=${t.course_id}&topic=${t.id}`, priority: 60 + t.importance });
  }

  // 5. Core topics not started.
  for (const t of topics.filter((t) => t.mastery.status === "not_started").sort((a, b) => b.importance - a.importance).slice(0, 2)) {
    recs.push({ id: `new-${t.id}`, kind: "start", title: `Learn “${t.title}”`, reason: t.importance >= 3 ? "A core topic you haven't studied yet." : `From ${t.document_name ?? t.course_title}. You haven't started this yet.`, href: `/tutor/${t.id}`, priority: 50 + t.importance * 3 });
  }

  return recs.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

export function todaysPlanItems() {
  return db()
    .prepare(
      `SELECT i.*, p.course_id, c.title course_title, c.color course_color FROM plan_items i JOIN study_plans p ON p.id = i.plan_id JOIN courses c ON c.id = p.course_id
       WHERE i.date = ? ORDER BY i.done, i.kind = 'flashcards' DESC`,
    )
    .all(today()) as { id: string; kind: string; title: string; minutes: number; done: number; topic_id: string | null; course_id: string; course_title: string; course_color: string }[];
}

export function dashboard() {
  const topics = allTopics();
  const struggling = topics
    .filter((t) => t.mastery.status === "weak" || (t.mastery.status === "developing" && t.mastery.mastery < 0.65))
    .sort((a, b) => a.mastery.mastery - b.mastery.mastery)
    .slice(0, 4)
    .map((t) => ({ id: t.id, title: t.title, course_title: t.course_title, course_color: t.course_color, mastery: t.mastery }));
  const due = (db().prepare("SELECT COUNT(*) n FROM cards WHERE due_at <= ? AND state != 'new'").get(nowIso()) as { n: number }).n;
  const fresh = (db().prepare("SELECT COUNT(*) n FROM cards WHERE state = 'new'").get() as { n: number }).n;
  const streak = studyStreak();
  const count = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  const firstCourse = db().prepare("SELECT id FROM courses ORDER BY updated_at DESC LIMIT 1").get() as { id: string } | undefined;
  const firstTopic = db().prepare("SELECT id FROM topics ORDER BY importance DESC, ord LIMIT 1").get() as { id: string } | undefined;
  const onboarding = {
    courses: count("SELECT COUNT(*) n FROM courses"),
    documents: count("SELECT COUNT(*) n FROM documents WHERE status = 'ready'"),
    lessons: count("SELECT COUNT(*) n FROM lessons") + count("SELECT COUNT(*) n FROM chat_messages"),
    quizzes: count("SELECT COUNT(*) n FROM attempts WHERE status = 'graded'"),
    reviews: count("SELECT COUNT(*) n FROM reviews"),
    notes: count("SELECT COUNT(*) n FROM notes WHERE content != ''"),
    courseId: firstCourse?.id ?? null,
    topicId: firstTopic?.id ?? null,
  };
  return { recommendations: recommendations(5), plan: todaysPlanItems(), struggling, upcoming: upcomingEvents(4), flashcards: { due, fresh }, streak, onboarding };
}

export function studyStreak(): number {
  const days = new Set(
    (db()
      .prepare(
        `SELECT DISTINCT substr(created_at, 1, 10) d FROM learning_events UNION SELECT DISTINCT substr(reviewed_at, 1, 10) FROM reviews`,
      )
      .all() as { d: string }[]).map((r) => r.d),
  );
  let n = 0;
  const d = new Date(today() + "T00:00:00Z");
  if (!days.has(today())) d.setUTCDate(d.getUTCDate() - 1); // streak still alive if you studied yesterday
  while (days.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

/** Everything the Progress page shows — all computed from real activity. */
export function progressReport(courseId?: string) {
  const cf = courseId ? "AND q.course_id = ?" : "";
  const args = courseId ? [courseId] : [];
  const scores = db()
    .prepare(
      `SELECT a.id, a.submitted_at at, a.score, a.max_score, q.title, c.title course_title, c.color course_color,
        (julianday(a.submitted_at) - julianday(a.started_at)) * 86400 seconds
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN courses c ON c.id = q.course_id
       WHERE a.status = 'graded' ${cf} ORDER BY a.submitted_at`,
    )
    .all(...args) as { id: string; at: string; score: number; max_score: number; title: string; course_title: string; course_color: string; seconds: number }[];

  const topics = (courseId ? listTopics(courseId) : allTopics()).map((t) => ({
    id: t.id,
    title: t.title,
    course_id: t.course_id,
    importance: t.importance,
    mastery: t.mastery,
  }));

  const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const reviewWhere = courseId ? "AND d.course_id = ?" : "";
  const reviewsByDay = db()
    .prepare(
      `SELECT substr(r.reviewed_at, 1, 10) day, COUNT(*) total, SUM(CASE WHEN r.rating >= 3 THEN 1 ELSE 0 END) correct
       FROM reviews r JOIN cards k ON k.id = r.card_id JOIN decks d ON d.id = k.deck_id
       WHERE r.reviewed_at >= ? ${reviewWhere} GROUP BY day ORDER BY day`,
    )
    .all(since, ...args) as { day: string; total: number; correct: number }[];

  const upcomingReviews = db()
    .prepare(
      `SELECT substr(k.due_at, 1, 10) day, COUNT(*) n FROM cards k JOIN decks d ON d.id = k.deck_id
       WHERE k.state != 'new' AND k.due_at <= ? ${reviewWhere} GROUP BY day ORDER BY day`,
    )
    .all(new Date(Date.now() + 7 * 86_400_000).toISOString(), ...args) as { day: string; n: number }[];

  const cardTotals = db()
    .prepare(
      `SELECT COUNT(*) total, SUM(CASE WHEN k.state='review' AND k.interval_days >= 21 THEN 1 ELSE 0 END) mastered,
        SUM(CASE WHEN k.state = 'new' THEN 1 ELSE 0 END) unseen FROM cards k JOIN decks d ON d.id = k.deck_id ${courseId ? "WHERE d.course_id = ?" : ""}`,
    )
    .get(...args) as { total: number; mastered: number | null; unseen: number | null };

  // Study time: only what we can measure reliably — timed quiz attempts and the
  // gaps between consecutive flashcard reviews (capped at 2 minutes each).
  const reviewTimes = db()
    .prepare(`SELECT r.reviewed_at FROM reviews r JOIN cards k ON k.id = r.card_id JOIN decks d ON d.id = k.deck_id WHERE r.reviewed_at >= ? ${reviewWhere} ORDER BY r.reviewed_at`)
    .all(since, ...args) as { reviewed_at: string }[];
  const minutesByDay = new Map<string, number>();
  for (let i = 1; i < reviewTimes.length; i++) {
    const gap = (new Date(reviewTimes[i].reviewed_at).getTime() - new Date(reviewTimes[i - 1].reviewed_at).getTime()) / 1000;
    if (gap > 0 && gap <= 120) {
      const day = reviewTimes[i].reviewed_at.slice(0, 10);
      minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + gap / 60);
    }
  }
  for (const s of scores) {
    if (!s.at || s.at.slice(0, 10) < since || !s.seconds || s.seconds > 4 * 3600) continue;
    const day = s.at.slice(0, 10);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + s.seconds / 60);
  }
  const activity: { day: string; minutes: number; reviews: number; accuracy: number | null }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const r = reviewsByDay.find((x) => x.day === day);
    activity.push({ day, minutes: Math.round(minutesByDay.get(day) ?? 0), reviews: r?.total ?? 0, accuracy: r?.total ? r.correct / r.total : null });
  }
  const totalReviews = reviewsByDay.reduce((s, r) => s + r.total, 0);
  const totalCorrect = reviewsByDay.reduce((s, r) => s + r.correct, 0);

  return {
    scores: scores.map((s) => ({ ...s, pct: s.max_score ? Math.round((s.score / s.max_score) * 100) : 0 })),
    topics,
    activity,
    upcomingReviews,
    flashcards: { total: cardTotals.total, mastered: cardTotals.mastered ?? 0, unseen: cardTotals.unseen ?? 0, accuracy30d: totalReviews ? totalCorrect / totalReviews : null, reviews30d: totalReviews },
    recommendations: recommendations(6),
    streak: studyStreak(),
  };
}
