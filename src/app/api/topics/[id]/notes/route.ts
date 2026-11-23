import { z } from "zod";
import { body, handle } from "@/lib/api";
import { refreshTopicNotes, saveMessageToNotes, topicNote } from "@/lib/services/notes";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]/notes">) => {
  const { id } = await ctx.params;
  return Response.json(topicNote(id));
});
/** { messageId } saves one tutor answer; { refresh: true } updates the notes from the whole conversation. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/notes">) => {
  const { id } = await ctx.params;
  const b = await body(req, z.object({ messageId: z.string().optional(), refresh: z.boolean().optional() }));
  if (b.messageId) saveMessageToNotes(id, b.messageId);
  if (b.refresh) await refreshTopicNotes(id);
  return Response.json(topicNote(id));
});
