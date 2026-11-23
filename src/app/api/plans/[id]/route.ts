import { handle } from "@/lib/api";
import { deletePlan } from "@/lib/services/planner";

export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/plans/[id]">) => {
  const { id } = await ctx.params;
  deletePlan(id);
  return Response.json({ ok: true });
});
