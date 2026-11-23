import { handle, HttpError, notFound, rateLimit } from "@/lib/api";
import { getNote, refreshTopicNotes } from "@/lib/services/notes";

/** Bring an automatic note up to date with the latest tutor conversation now. */
export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/notes/[id]/refresh">) => {
  const { id } = await ctx.params;
  rateLimit("notes", 10);
  const n = getNote(id) ?? notFound();
  if (n.kind !== "auto" || !n.topic_id) throw new HttpError(400, "Only topic notes can be updated from the conversation.");
  await refreshTopicNotes(n.topic_id);
  return Response.json(getNote(id));
});
