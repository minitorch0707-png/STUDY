import { z } from "zod";
import { body, handle, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { clearChat, ndjsonResponse, streamTutorReply } from "@/lib/services/tutor";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/chat">) => {
  const { id } = await ctx.params;
  rateLimit("chat", 30);
  const b = await body(req, z.object({ message: z.string().max(4000).optional(), action: z.string().max(40).optional(), socratic: z.boolean().optional() }));
  await requireChatModel();
  return ndjsonResponse(streamTutorReply({ topicId: id, ...b }));
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]/chat">) => {
  const { id } = await ctx.params;
  clearChat(id);
  return Response.json({ ok: true });
});
