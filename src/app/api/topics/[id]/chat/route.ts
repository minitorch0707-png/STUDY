import { z } from "zod";
import { body, handle, HttpError, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { clearChat, getMessage, sendTutorMessage } from "@/lib/services/tutor";

/**
 * Send a message. Returns at once with the stored message ids; the answer is
 * written in the background — follow it at /api/tutor/messages/{id}/stream.
 * Sending the same clientId twice returns the original messages (no duplicates).
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/chat">) => {
  const { id } = await ctx.params;
  rateLimit("chat", 30);
  const b = await body(
    req,
    z.object({ message: z.string().max(4000).optional(), action: z.string().max(40).optional(), socratic: z.boolean().optional(), clientId: z.string().max(80).optional() }),
  );
  await requireChatModel();
  try {
    const r = sendTutorMessage({ topicId: id, ...b });
    return Response.json({ ...r, user: getMessage(r.userMessageId), assistant: getMessage(r.assistantMessageId) });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]/chat">) => {
  const { id } = await ctx.params;
  clearChat(id);
  return Response.json({ ok: true });
});
