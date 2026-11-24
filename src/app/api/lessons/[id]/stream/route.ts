import { handle } from "@/lib/api";
import { liveResponse } from "@/lib/services/live";
import { followLesson } from "@/lib/services/tutor";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/lessons/[id]/stream">) => {
  const { id } = await ctx.params;
  const from = Math.max(0, Number(new URL(req.url).searchParams.get("from") ?? 0) || 0);
  return liveResponse(followLesson(id, from));
});
