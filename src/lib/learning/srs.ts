/**
 * Spaced repetition, based on the SM-2 family of algorithms used by Anki.
 *
 * In plain English: every card has an "ease". Answering Good multiplies the gap
 * before you see it again by that ease (1 day → 2.5 days → 6 days → …). Hard
 * grows the gap only a little and lowers the ease; Again sends the card back for
 * relearning today. New cards go through two short learning steps first.
 */

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export type CardState = "new" | "learning" | "review" | "relearning";

export interface SrsCard {
  state: CardState;
  step: number;
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  dueAt: Date;
}

export const LEARNING_STEPS_MIN = [1, 10];
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_INTERVAL = 1;
export const EASY_INTERVAL = 4;
export const MIN_EASE = 1.3;
export const MAX_INTERVAL = 365;
export const MASTERED_INTERVAL = 21;

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const clampInterval = (d: number) => Math.min(MAX_INTERVAL, Math.max(1, Math.round(d)));

export function newCard(now = new Date()): SrsCard {
  return { state: "new", step: 0, ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt: now };
}

export function schedule(card: SrsCard, rating: Rating, now = new Date()): SrsCard {
  const c: SrsCard = { ...card, reps: card.reps + 1 };

  if (card.state === "new" || card.state === "learning") {
    const steps = LEARNING_STEPS_MIN;
    if (rating === 1) return { ...c, state: "learning", step: 0, dueAt: addMinutes(now, steps[0]) };
    if (rating === 2) {
      const cur = steps[Math.min(card.step, steps.length - 1)];
      const nxt = steps[Math.min(card.step + 1, steps.length - 1)];
      return { ...c, state: "learning", dueAt: addMinutes(now, Math.round((cur + nxt) / 2)) };
    }
    if (rating === 4) return { ...c, state: "review", step: 0, intervalDays: EASY_INTERVAL, ease: card.ease + 0.15, dueAt: addDays(now, EASY_INTERVAL) };
    const next = card.step + 1;
    if (next >= steps.length) return { ...c, state: "review", step: 0, intervalDays: GRADUATING_INTERVAL, dueAt: addDays(now, GRADUATING_INTERVAL) };
    return { ...c, state: "learning", step: next, dueAt: addMinutes(now, steps[next]) };
  }

  if (card.state === "relearning") {
    if (rating === 1) return { ...c, step: 0, dueAt: addMinutes(now, RELEARNING_STEPS_MIN[0]) };
    const iv = clampInterval(rating === 4 ? card.intervalDays * 1.5 : card.intervalDays);
    return { ...c, state: "review", step: 0, intervalDays: iv, dueAt: addDays(now, iv) };
  }

  // review
  if (rating === 1) {
    const iv = clampInterval(card.intervalDays * 0.5);
    return {
      ...c,
      state: "relearning",
      step: 0,
      lapses: card.lapses + 1,
      ease: Math.max(MIN_EASE, card.ease - 0.2),
      intervalDays: iv,
      dueAt: addMinutes(now, RELEARNING_STEPS_MIN[0]),
    };
  }
  // Reward reviewing a card late (it was remembered despite the longer gap).
  const daysLate = Math.max(0, (now.getTime() - card.dueAt.getTime()) / 86_400_000);
  let ease = card.ease;
  let iv: number;
  if (rating === 2) {
    ease = Math.max(MIN_EASE, ease - 0.15);
    iv = card.intervalDays * 1.2;
  } else if (rating === 3) {
    iv = (card.intervalDays + daysLate / 2) * ease;
  } else {
    ease = ease + 0.15;
    iv = (card.intervalDays + daysLate) * ease * 1.3;
  }
  iv = Math.max(clampInterval(iv), card.intervalDays + 1);
  iv = Math.min(iv, MAX_INTERVAL);
  return { ...c, state: "review", ease, intervalDays: iv, dueAt: addDays(now, iv) };
}

/** Preview the next interval for each button (shown on the rating buttons). */
export function previewIntervals(card: SrsCard, now = new Date()): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const r of [1, 2, 3, 4] as Rating[]) out[r] = formatInterval(schedule(card, r, now).dueAt.getTime() - now.getTime());
  return out;
}

export function formatInterval(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}mo` : `${(d / 365).toFixed(1)}y`;
}

export const isMastered = (c: Pick<SrsCard, "state" | "intervalDays">) => c.state === "review" && c.intervalDays >= MASTERED_INTERVAL;
