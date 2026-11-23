import { handle, notFound } from "@/lib/api";
import { getAttempt, submitAttempt } from "@/lib/services/quiz";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/attempts/[id]/submit">) => {
  const { id } = await ctx.params;
  if (!getAttempt(id)) notFound();
  submitAttempt(id);
  return Response.json({ ok: true });
});
