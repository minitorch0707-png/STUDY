import { handle, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { ndjsonResponse, streamLesson } from "@/lib/services/tutor";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]/lesson">) => {
  const { id } = await ctx.params;
  rateLimit("lesson", 10);
  await requireChatModel(); // fail fast with a clear message before streaming
  return ndjsonResponse(streamLesson(id));
});
