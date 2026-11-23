import "server-only";
import { z } from "zod";
import { AIUnavailableError } from "@/lib/ai/types";
import { resumeInterruptedJobs } from "@/lib/services/documents";
import { logEvent } from "@/lib/logs";
import { LicenseError } from "@/lib/license";

/** Shared helpers for API routes: consistent errors, validation and rate limits. */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    resumeInterruptedJobs();
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof LicenseError) return Response.json({ error: e.message, needsPro: true }, { status: 402 });
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof AIUnavailableError) return Response.json({ error: e.message, aiUnavailable: true }, { status: 503 });
      if (e instanceof z.ZodError) return Response.json({ error: e.issues.map((i) => i.message).join("; ") }, { status: 400 });
      console.error(e);
      logEvent("error", "api", `${(e as Error).name}: ${(e as Error).message}\n${((e as Error).stack ?? "").split("\n").slice(1, 4).join("\n")}`);
      return Response.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}

export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Invalid request body");
  }
  return schema.parse(json);
}

export function notFound(what = "Not found"): never {
  throw new HttpError(404, what);
}

/**
 * Token-bucket rate limiter (per key, in memory). Even locally this protects
 * against runaway loops (e.g. a stuck browser tab) hammering the model.
 */
const buckets = new Map<string, { tokens: number; at: number }>();
export function rateLimit(key: string, perMinute: number) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw new HttpError(429, "You're going a bit fast — please wait a few seconds and try again.");
  }
  b.tokens -= 1;
  buckets.set(key, b);
}
