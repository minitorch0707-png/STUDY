import { z } from "zod";
import { body, handle, HttpError, notFound } from "@/lib/api";
import { getAttempt, saveAnswer } from "@/lib/services/quiz";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/attempts/[id]">) => {
  const { id } = await ctx.params;
  return Response.json(getAttempt(id) ?? notFound("Attempt not found"));
});
/** Autosave an answer. */
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/attempts/[id]">) => {
  const { id } = await ctx.params;
  const a = getAttempt(id) ?? notFound();
  if (a.attempt.status !== "in_progress") throw new HttpError(409, "This attempt was already submitted.");
  const { questionId, answer } = await body(req, z.object({ questionId: z.string(), answer: z.unknown() }));
  saveAnswer(id, questionId, answer);
  return Response.json({ ok: true });
});
