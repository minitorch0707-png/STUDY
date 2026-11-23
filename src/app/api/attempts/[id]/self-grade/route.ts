import { z } from "zod";
import { body, handle } from "@/lib/api";
import { getAttempt, selfGrade } from "@/lib/services/quiz";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/attempts/[id]/self-grade">) => {
  const { id } = await ctx.params;
  const { questionId, verdicts } = await body(req, z.object({ questionId: z.string(), verdicts: z.array(z.enum(["yes", "partial", "no"])) }));
  selfGrade(id, questionId, verdicts);
  return Response.json(getAttempt(id));
});
