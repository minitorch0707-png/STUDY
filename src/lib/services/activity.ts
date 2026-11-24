import "server-only";
import { db, newId, nowIso } from "@/lib/db";
import { localDateIso, addDays } from "@/lib/dates";

/**
 * Study activity: how much local AI work LectureLab did. Only metadata is
 * stored (counts, timings, model name). Never prompts, answers, course names
 * or file contents.
 */

export interface UsageRecord {
  runKey: string;
  task: string;
  replyId?: string | null;
  completed: boolean;
  provider: string;
  model: string;
  localOnly: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  firstTextMs?: number | null;
  outputTokensPerS?: number | null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export function recordUsage(r: UsageRecord) {
  try {
    db()
      .prepare(
        `INSERT OR IGNORE INTO usage_events (id, run_key, day, created_at, task, reply_id, completed, provider, model, local_only, input_tokens, output_tokens, duration_ms, first_text_ms, output_tokens_per_s)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        newId(),
        r.runKey,
        localDateIso(),
        nowIso(),
        r.task,
        r.replyId ?? null,
        r.completed ? 1 : 0,
        r.provider,
        r.model,
        r.localOnly ? 1 : 0,
        num(r.inputTokens),
        num(r.outputTokens),
        num(r.durationMs),
        num(r.firstTextMs),
        typeof r.outputTokensPerS === "number" && Number.isFinite(r.outputTokensPerS) ? Math.round(r.outputTokensPerS * 10) / 10 : null,
      );
  } catch {
    /* activity tracking must never break studying */
  }
}

export type ActivityRange = "today" | "7d" | "30d";

export function activityReport(range: ActivityRange, today = localDateIso()) {
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const from = addDays(today, -(days - 1));
  const rows = db()
    .prepare("SELECT * FROM usage_events WHERE day >= ? AND day <= ? ORDER BY created_at")
    .all(from, today) as {
    day: string;
    task: string;
    reply_id: string | null;
    completed: number;
    provider: string;
    model: string;
    local_only: number;
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
    first_text_ms: number | null;
    output_tokens_per_s: number | null;
  }[];

  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const inputRuns = rows.filter((r) => r.input_tokens !== null);
  const outputRuns = rows.filter((r) => r.output_tokens !== null);
  const fullyCounted = rows.filter((r) => r.input_tokens !== null && r.output_tokens !== null);
  const replies = new Set(rows.filter((r) => r.task === "tutor" && r.completed && r.reply_id).map((r) => r.reply_id)).size;

  const daily: { day: string; tokens: number | null }[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    const dayRows = rows.filter((r) => r.day === day);
    const counted = dayRows.filter((r) => r.input_tokens !== null || r.output_tokens !== null);
    daily.push({ day, tokens: dayRows.length && !counted.length ? null : sum(counted.map((r) => (r.input_tokens ?? 0) + (r.output_tokens ?? 0))) });
  }

  const byModel = new Map<string, typeof rows>();
  for (const r of rows) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };

  return {
    range,
    from,
    to: today,
    runs: rows.length,
    inputTokens: inputRuns.length ? sum(inputRuns.map((r) => r.input_tokens)) : null,
    outputTokens: outputRuns.length ? sum(outputRuns.map((r) => r.output_tokens)) : null,
    tokensProcessed: inputRuns.length || outputRuns.length ? sum(rows.map((r) => (r.input_tokens ?? 0) + (r.output_tokens ?? 0))) : null,
    /** Runs where the runtime didn't report one or both counts: totals don't cover them. */
    runsMissingCounts: rows.length - fullyCounted.length,
    /** Input/output split, only over runs that reported both (used for cost estimates). */
    countedInput: sum(fullyCounted.map((r) => r.input_tokens)),
    countedOutput: sum(fullyCounted.map((r) => r.output_tokens)),
    completedReplies: replies,
    allLocal: rows.every((r) => r.local_only === 1),
    nonLocalRuns: rows.filter((r) => !r.local_only).length,
    daily,
    models: [...byModel.entries()].map(([model, rs]) => ({
      model,
      runs: rs.length,
      outputTokensPerS: avg(rs.map((r) => r.output_tokens_per_s)),
      firstTextMs: avg(rs.map((r) => r.first_text_ms)),
    })),
  };
}
