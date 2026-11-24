import { handle, notFound, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { getMessage, retryAnswer } from "@/lib/services/tutor";

/** Retry an interrupted or failed answer in place (same message — never a duplicate). */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/tutor/messages/[id]/retry">) => {
  const { id } = await ctx.params;
  rateLimit("chat", 30);
  if (!getMessage(id)) notFound("Message not found");
  await requireChatModel();
  const restarted = retryAnswer(id);
  return Response.json({ restarted, message: getMessage(id) });
});
