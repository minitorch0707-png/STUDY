import { handle, HttpError, notFound } from "@/lib/api";
import { getQuiz, startAttempt } from "@/lib/services/quiz";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/quizzes/[id]/attempts">) => {
  const { id } = await ctx.params;
  const quiz = getQuiz(id) ?? notFound();
  if (quiz.status !== "ready") throw new HttpError(409, "This quiz isn't ready yet.");
  return Response.json({ attemptId: startAttempt(id) });
});
