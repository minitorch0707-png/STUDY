import "server-only";

/**
 * Live generations (tutor answers and lessons).
 *
 * A generation runs in the background, independent of any browser request, so
 * the student can switch screens while the AI keeps writing. Text is streamed
 * to whoever is watching and checkpointed to the database at most every
 * CHECKPOINT_MS, so writing to disk never slows the stream. If the app quits
 * mid-answer, the last checkpoint is restored on restart as "interrupted".
 */

export const CHECKPOINT_MS = 400;

export type LiveEvent =
  | { type: "text"; text: string; at: number } // `at` = offset of this piece in the full text
  | { type: "meta"; [k: string]: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

interface Live {
  text: string;
  status: "streaming" | "complete" | "failed";
  error?: string;
  listeners: Set<(e: LiveEvent) => void>;
  meta: Record<string, unknown>;
}

const g = globalThis as unknown as { __llLive?: Map<string, Live> };
const registry = (g.__llLive ??= new Map());

export interface LiveHooks {
  /** Persist partial text (throttled). */
  checkpoint(text: string): void;
  /** Persist the finished text. */
  complete(text: string): void | Promise<void>;
  /** Persist the failure (partial text is kept). */
  fail(text: string, error: Error): void;
}

export const isLive = (key: string) => registry.get(key)?.status === "streaming";

/**
 * Start a generation unless one is already running for this key (idempotent).
 * `run` receives `emit` for text pieces and `meta` for side information.
 */
export function startLive(key: string, run: (emit: (piece: string) => void, meta: (m: Record<string, unknown>) => void) => Promise<void>, hooks: LiveHooks): boolean {
  if (isLive(key)) return false;
  const live: Live = { text: "", status: "streaming", listeners: new Set(), meta: {} };
  registry.set(key, live);
  const notify = (e: LiveEvent) => {
    for (const l of live.listeners) {
      try {
        l(e);
      } catch {
        /* a broken listener must not stop generation */
      }
    }
  };
  // A generation that is no longer the current one for its key (e.g. after a
  // restart or a retry) must never write its stale result over the new one.
  const current = () => registry.get(key) === live;
  let lastCheckpoint = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    pending = null;
    lastCheckpoint = Date.now();
    if (!current()) return;
    try {
      hooks.checkpoint(live.text);
    } catch {
      /* best effort */
    }
  };
  const emit = (piece: string) => {
    if (!piece) return;
    const at = live.text.length;
    live.text += piece;
    notify({ type: "text", text: piece, at });
    if (!pending) pending = setTimeout(flush, Math.max(0, CHECKPOINT_MS - (Date.now() - lastCheckpoint)));
  };
  const meta = (m: Record<string, unknown>) => {
    Object.assign(live.meta, m);
    notify({ type: "meta", ...m });
  };
  void (async () => {
    try {
      await run(emit, meta);
      if (pending) clearTimeout(pending);
      if (current()) await hooks.complete(live.text);
      live.status = "complete";
      notify({ type: "done" });
    } catch (e) {
      if (pending) clearTimeout(pending);
      live.status = "failed";
      live.error = (e as Error).message;
      try {
        if (current()) hooks.fail(live.text, e as Error);
      } catch {
        /* best effort */
      }
      notify({ type: "error", message: live.error });
    } finally {
      // Keep the finished state briefly so late subscribers get a clean ending, then forget it.
      setTimeout(() => {
        if (registry.get(key) === live) registry.delete(key);
      }, 30_000);
    }
  })();
  return true;
}

/**
 * Follow a generation from character offset `from`. If it isn't running here
 * (finished earlier, or interrupted by a restart), the stored state is replayed.
 */
export async function* subscribe(
  key: string,
  from: number,
  stored: () => { text: string; status: string; error?: string | null; meta?: Record<string, unknown> },
): AsyncGenerator<LiveEvent> {
  const live = registry.get(key);
  if (!live) {
    const s = stored();
    if (s.meta && Object.keys(s.meta).length) yield { type: "meta", ...s.meta };
    if (s.text.length > from) yield { type: "text", text: s.text.slice(from), at: from };
    if (s.status === "complete") yield { type: "done" };
    else yield { type: "error", message: s.error || (s.status === "interrupted" ? "interrupted" : `status: ${s.status}`) };
    return;
  }
  const queue: LiveEvent[] = [];
  let wake: (() => void) | null = null;
  const listener = (e: LiveEvent) => {
    queue.push(e);
    wake?.();
  };
  live.listeners.add(listener);
  try {
    if (Object.keys(live.meta).length) yield { type: "meta", ...live.meta };
    if (live.text.length > from) yield { type: "text", text: live.text.slice(from), at: from };
    if (live.status === "complete") return void (yield { type: "done" });
    if (live.status === "failed") return void (yield { type: "error", message: live.error ?? "failed" });
    let delivered = Math.max(from, live.text.length);
    for (;;) {
      while (!queue.length) await new Promise<void>((r) => (wake = r));
      wake = null;
      const e = queue.shift()!;
      if (e.type === "text") {
        // Skip text already sent in the catch-up above.
        const end = e.at + e.text.length;
        if (end <= delivered) continue;
        const piece = e.text.slice(Math.max(0, delivered - e.at));
        delivered = end;
        yield { type: "text", text: piece, at: end - piece.length };
        continue;
      }
      yield e;
      if (e.type === "done" || e.type === "error") return;
    }
  } finally {
    live.listeners.delete(listener);
  }
}

/** Wrap events as a streaming HTTP response (one JSON object per line). */
export function liveResponse(gen: AsyncGenerator<LiveEvent>): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of gen) {
          if (cancelled) break;
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        }
      } catch (e) {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: (e as Error).message }) + "\n"));
      } finally {
        if (!cancelled) controller.close();
        await gen.return(undefined);
      }
    },
    cancel() {
      // The browser left: stop sending, but the generation itself keeps going.
      cancelled = true;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
