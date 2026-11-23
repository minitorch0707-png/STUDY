import { z } from "zod";
import { body, handle, HttpError, notFound, rateLimit } from "@/lib/api";
import { checkOne, getAttempt } from "@/lib/services/quiz";

/** Practice mode: grade a single answer immediately. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/attempts/[id]/check">) => {
  const { id } = await ctx.params;
  rateLimit("check", 60);
  const a = getAttempt(id) ?? notFound();
  if (a.quiz.config.mode !== "practice" || !a.quiz.config.immediateFeedback) throw new HttpError(400, "Immediate feedback is off for this quiz.");
  const { questionId, answer } = await body(req, z.object({ questionId: z.string(), answer: z.unknown() }));
  await checkOne(id, questionId, answer);
  return Response.json(getAttempt(id));
});
