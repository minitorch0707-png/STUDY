import "server-only";
import { db, newId, nowIso } from "@/lib/db";

/** Log an AI generation (evaluation baseline + future fine-tuning data). */
export function logGeneration(g: { task: string; model: string; prompt: string; output: string; durationMs?: number; outputTokens?: number; refId?: string }) {
  const id = newId();
  db()
    .prepare(
      "INSERT INTO ai_generations (id, task, model, prompt, output, duration_ms, output_tokens, ref_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(id, g.task, g.model, g.prompt.slice(0, 60_000), g.output.slice(0, 60_000), g.durationMs ?? null, g.outputTokens ?? null, g.refId ?? null, nowIso());
  return id;
}

export function rateGeneration(id: string, rating: 1 | -1 | null) {
  db().prepare("UPDATE ai_generations SET rating = ? WHERE id = ?").run(rating, id);
}

export function generationStats() {
  return db()
    .prepare(
      `SELECT task, COUNT(*) n, AVG(duration_ms) avg_ms, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) up, SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) down
       FROM ai_generations GROUP BY task ORDER BY n DESC`,
    )
    .all() as { task: string; n: number; avg_ms: number | null; up: number; down: number }[];
}

/** Background job runner: errors are recorded by the job itself, never crash the server. */
export function runInBackground(name: string, fn: () => Promise<void>) {
  setTimeout(() => {
    fn().catch((e) => console.error(`[background:${name}]`, e));
  }, 0);
}
