/**
 * Mastery estimates come ONLY from the student's real answers (quiz questions,
 * knowledge checks, flashcard reviews) — never from AI guesses.
 *
 * Method (plain English): each answer counts as evidence for or against the
 * student knowing the topic. Recent answers count more than old ones (evidence
 * halves in weight every 21 days). We start from a neutral "don't know yet"
 * prior and report both the estimate and how much evidence it's based on.
 */

export interface Evidence {
  score: number; // 0..1
  at: Date;
  kind: string;
}

export const HALF_LIFE_DAYS = 21;
const KIND_WEIGHT: Record<string, number> = { quiz: 1, check: 0.6, flashcard: 0.5 };
export const MIN_EVIDENCE = 3;

export interface MasteryEstimate {
  mastery: number; // 0..1
  evidence: number; // effective number of answers
  attempts: number;
  status: "not_started" | "insufficient" | "weak" | "developing" | "strong";
}

export function estimateMastery(events: Evidence[], now = new Date()): MasteryEstimate {
  let a = 1; // prior "successes"
  let b = 1; // prior "failures"
  let n = 0;
  for (const e of events) {
    const ageDays = Math.max(0, (now.getTime() - e.at.getTime()) / 86_400_000);
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS) * (KIND_WEIGHT[e.kind] ?? 0.5);
    const s = Math.min(1, Math.max(0, e.score));
    a += w * s;
    b += w * (1 - s);
    n += w;
  }
  const mastery = a / (a + b);
  let status: MasteryEstimate["status"];
  if (events.length === 0) status = "not_started";
  else if (events.length < MIN_EVIDENCE) status = "insufficient";
  else if (mastery < 0.55) status = "weak";
  else if (mastery < 0.8) status = "developing";
  else status = "strong";
  return { mastery, evidence: n, attempts: events.length, status };
}

export const STATUS_LABEL: Record<MasteryEstimate["status"], string> = {
  not_started: "Not started",
  insufficient: "Too early to tell",
  weak: "Needs work",
  developing: "Getting there",
  strong: "Strong",
};
