import { z } from "zod";
import { body, handle, rateLimit } from "@/lib/api";
import { answerCheck, lessonChecks } from "@/lib/services/tutor";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]/checks">) => {
  const { id } = await ctx.params;
  rateLimit("checks", 10);
  return Response.json({ checks: await lessonChecks(id) });
});
/** Record the student's answer to a knowledge check (evidence for mastery). */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/checks">) => {
  const { id } = await ctx.params;
  const { correct } = await body(req, z.object({ correct: z.boolean() }));
  answerCheck(id, correct);
  return Response.json({ ok: true });
});
