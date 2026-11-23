import { body, handle, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { createQuiz, listQuizzes, quizConfigSchema } from "@/lib/services/quiz";
import { requirePro } from "@/lib/license";

export const GET = handle((req: Request) => Response.json(listQuizzes(new URL(req.url).searchParams.get("course") ?? undefined)));
export const POST = handle(async (req: Request) => {
  rateLimit("quiz", 10);
  const config = await body(req, quizConfigSchema);
  if (config.mode === "exam" || config.timeLimitMinutes) requirePro("examSimulation");
  await requireChatModel();
  return Response.json({ id: createQuiz(config) }, { status: 201 });
});
