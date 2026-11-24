import { z } from "zod";
import { body, handle, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { getLesson, startLesson } from "@/lib/services/tutor";

/** Start the lesson in the background (or return the existing one). Follow it at /api/lessons/{id}/stream. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/lesson">) => {
  const { id } = await ctx.params;
  rateLimit("lesson", 10);
  const { regenerate } = await body(req, z.object({ regenerate: z.boolean().optional() })).catch(() => ({ regenerate: false }));
  await requireChatModel();
  const lessonId = startLesson(id, Boolean(regenerate));
  return Response.json({ lessonId, lesson: getLesson(id) });
});
