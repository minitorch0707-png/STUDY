import { handle, HttpError, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { retakeMistakes } from "@/lib/services/quiz";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/attempts/[id]/retake">) => {
  const { id } = await ctx.params;
  rateLimit("quiz", 10);
  await requireChatModel();
  const quizId = retakeMistakes(id);
  if (!quizId) throw new HttpError(400, "No mistakes to retake — nice work!");
  return Response.json({ id: quizId });
});
