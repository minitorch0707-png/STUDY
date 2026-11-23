/**
 * Study plan generator — deterministic, explainable, no AI needed.
 *
 * Plain English: we rank topics by (how important × how weak you are), then lay
 * them out day by day within your daily time budget. Each topic gets a first
 * study session, a spaced review a couple of days later, and everything gets a
 * final review. The day before the exam is a full mock exam. If there isn't
 * enough time for everything ("Exam Cram"), the least important / strongest
 * topics are dropped and we tell you exactly which ones.
 */

export interface PlanTopic {
  id: string;
  title: string;
  importance: number; // 1..3
  mastery: number; // 0..1
  attempts: number;
}

export interface PlanItem {
  date: string; // YYYY-MM-DD
  kind: "learn" | "review" | "flashcards" | "quiz" | "mock_exam";
  topicId: string | null;
  title: string;
  minutes: number;
}

export interface PlanResult {
  items: PlanItem[];
  cram: boolean;
  skippedTopics: string[];
  notes: string[];
}

const LEARN_MIN = 35;
const REVIEW_MIN = 15;
const MOCK_MIN = 60;
const FLASH_MIN = 10;

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso + "T00:00:00Z").getTime() - new Date(fromIso + "T00:00:00Z").getTime()) / 86_400_000);
}

export function priority(t: PlanTopic): number {
  const weakness = t.attempts === 0 ? 0.75 : 1 - t.mastery; // unknown = assume fairly weak
  return t.importance * (0.4 + weakness);
}

export function buildPlan(opts: { today: string; examDate: string; dailyMinutes: number; topics: PlanTopic[]; forceCram?: boolean }): PlanResult {
  const { today, examDate, topics } = opts;
  const daily = Math.max(15, opts.dailyMinutes);
  const studyDays = daysBetween(today, examDate); // days before exam day
  const notes: string[] = [];
  if (studyDays <= 0) return { items: [], cram: true, skippedTopics: [], notes: ["The exam date is today or in the past."] };

  const ranked = [...topics].sort((a, b) => priority(b) - priority(a));
  const mockDay = studyDays >= 2 ? addDaysIso(examDate, -1) : null;
  const regularDays = mockDay ? studyDays - 1 : studyDays;
  const capacity = regularDays * daily;
  const needFull = ranked.length * (LEARN_MIN + REVIEW_MIN) + regularDays * FLASH_MIN;
  const cram = Boolean(opts.forceCram) || needFull > capacity;

  // In cram mode, keep the highest-priority topics that fit, with shorter sessions.
  const learnMin = cram ? 25 : LEARN_MIN;
  const reviewMin = cram ? 10 : REVIEW_MIN;
  const flashMin = cram ? 5 : FLASH_MIN;
  let chosen = ranked;
  const skipped: string[] = [];
  if (cram) {
    const perTopic = learnMin + reviewMin;
    const fit = Math.max(1, Math.floor((capacity - regularDays * flashMin) / perTopic));
    chosen = ranked.slice(0, fit);
    skipped.push(...ranked.slice(fit).map((t) => t.title));
    notes.push(
      skipped.length
        ? `Exam Cram: there isn't time to cover everything well, so we prioritised your ${chosen.length} most important and weakest topics.`
        : "Exam Cram: shorter, focused sessions to fit your time.",
    );
  }

  const days: { date: string; used: number; items: PlanItem[] }[] = [];
  for (let i = 0; i < regularDays; i++) days.push({ date: addDaysIso(today, i), used: 0, items: [] });
  const place = (fromIdx: number, item: Omit<PlanItem, "date">) => {
    for (let i = Math.max(0, fromIdx); i < days.length; i++) {
      if (days[i].used + item.minutes <= daily || (days[i].items.length === 0 && item.minutes > daily)) {
        days[i].items.push({ ...item, date: days[i].date });
        days[i].used += item.minutes;
        return i;
      }
    }
    return -1;
  };

  // Daily flashcards first (small, keeps spaced repetition going).
  for (const d of days) {
    d.items.push({ date: d.date, kind: "flashcards", topicId: null, title: "Review due flashcards", minutes: flashMin });
    d.used += flashMin;
  }

  // Learn sessions spread across the first ~70% of the time; review 2 days later.
  const learnWindow = Math.max(1, Math.ceil(regularDays * 0.7));
  chosen.forEach((t, i) => {
    const target = Math.floor((i * learnWindow) / Math.max(1, chosen.length));
    const at = place(target, { kind: "learn", topicId: t.id, title: `Study: ${t.title}`, minutes: learnMin });
    if (at === -1) {
      skipped.push(t.title);
      return;
    }
    place(Math.min(at + 2, days.length - 1), { kind: "review", topicId: t.id, title: `Review + quiz: ${t.title}`, minutes: reviewMin });
  });

  const items = days.flatMap((d) => d.items);
  if (mockDay) items.push({ date: mockDay, kind: "mock_exam", topicId: null, title: "Full mock exam under timed conditions", minutes: Math.min(MOCK_MIN, Math.max(daily, 30)) });
  notes.push("This plan is a guide based on your quiz results so far — it can't guarantee a grade. Re-generate it as your results change.");
  return { items, cram, skippedTopics: [...new Set(skipped)], notes };
}
