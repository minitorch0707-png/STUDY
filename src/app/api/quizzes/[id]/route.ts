import { handle, notFound } from "@/lib/api";
import { deleteQuiz, getQuiz } from "@/lib/services/quiz";
import { db } from "@/lib/db";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/quizzes/[id]">) => {
  const { id } = await ctx.params;
  const quiz = getQuiz(id) ?? notFound("Quiz not found");
  const count = (db().prepare("SELECT COUNT(*) n FROM questions WHERE quiz_id = ?").get(id) as { n: number }).n;
  const attempts = db().prepare("SELECT * FROM attempts WHERE quiz_id = ? ORDER BY started_at DESC").all(id);
  return Response.json({ quiz, questionCount: count, attempts });
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/quizzes/[id]">) => {
  const { id } = await ctx.params;
  deleteQuiz(id);
  return Response.json({ ok: true });
});
