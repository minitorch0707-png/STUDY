import { handle, notFound } from "@/lib/api";
import { liveResponse } from "@/lib/services/live";
import { followMessage, getMessage } from "@/lib/services/tutor";

/** Follow an answer as it's written, starting at character `from` (re-attach after switching screens). */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/tutor/messages/[id]/stream">) => {
  const { id } = await ctx.params;
  if (!getMessage(id)) notFound("Message not found");
  const from = Math.max(0, Number(new URL(req.url).searchParams.get("from") ?? 0) || 0);
  return liveResponse(followMessage(id, from));
});
