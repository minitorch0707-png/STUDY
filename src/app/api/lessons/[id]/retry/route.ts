import { handle, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { retryLesson } from "@/lib/services/tutor";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/lessons/[id]/retry">) => {
  const { id } = await ctx.params;
  rateLimit("lesson", 10);
  await requireChatModel();
  return Response.json({ restarted: retryLesson(id) });
});
