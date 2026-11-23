import type { QuestionType } from "@/lib/ai/prompts";

/** Shapes of the per-question data stored in questions.data (JSON). */
export interface QuestionData {
  options?: string[];
  correctIndex?: number;
  correctBoolean?: boolean;
  pairs?: { left: string; right: string }[];
  /** For matching: the right-hand items in the order shown to the student. */
  shuffledRights?: string[];
  modelAnswer?: string;
  rubric?: { point: string; weight: number }[];
}

export const WRITTEN_TYPES: QuestionType[] = ["short_answer", "essay", "definition", "scenario"];
export const isWritten = (t: string) => (WRITTEN_TYPES as string[]).includes(t);

export function maxScoreFor(type: QuestionType): number {
  if (type === "essay") return 5;
  if (type === "short_answer" || type === "scenario") return 3;
  if (type === "definition") return 2;
  if (type === "matching") return 4;
  return 1;
}

export interface ObjectiveResult {
  score: number;
  correct: boolean;
  detail?: { left: string; chosen: string | null; correct: string; ok: boolean }[];
}

/** Grade questions that have one right answer — no AI needed. */
export function gradeObjective(type: string, data: QuestionData, answer: unknown, maxScore: number): ObjectiveResult {
  if (type === "mcq") {
    const ok = typeof answer === "number" && answer === data.correctIndex;
    return { score: ok ? maxScore : 0, correct: ok };
  }
  if (type === "true_false") {
    const ok = typeof answer === "boolean" && answer === data.correctBoolean;
    return { score: ok ? maxScore : 0, correct: ok };
  }
  if (type === "matching") {
    const pairs = data.pairs ?? [];
    const chosen = (answer && typeof answer === "object" ? answer : {}) as Record<string, string>;
    const detail = pairs.map((p) => ({ left: p.left, chosen: chosen[p.left] ?? null, correct: p.right, ok: chosen[p.left] === p.right }));
    const right = detail.filter((d) => d.ok).length;
    const score = pairs.length ? Math.round(((right / pairs.length) * maxScore) * 100) / 100 : 0;
    return { score, correct: right === pairs.length, detail };
  }
  throw new Error(`Not an objective question type: ${type}`);
}

export type RubricVerdict = "yes" | "partial" | "no";

/** Turn per-point rubric verdicts into a score. Transparent and reproducible. */
export function scoreRubric(rubric: { weight: number }[], verdicts: RubricVerdict[], maxScore: number): number {
  const total = rubric.reduce((s, r) => s + (r.weight || 1), 0) || 1;
  const earned = rubric.reduce((s, r, i) => s + (r.weight || 1) * (verdicts[i] === "yes" ? 1 : verdicts[i] === "partial" ? 0.5 : 0), 0);
  return Math.round((earned / total) * maxScore * 100) / 100;
}

/** Deterministic shuffle (seeded) so option order is stable for a given question. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Normalised fingerprint + similarity, used to avoid repeating questions. */
export function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .sort()
    .join(" ");
}

export function similarity(fpA: string, fpB: string): number {
  const a = new Set(fpA.split(" ").filter(Boolean));
  const b = new Set(fpB.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
