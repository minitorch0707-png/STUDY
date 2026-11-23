import { z } from "zod";
import { body, handle } from "@/lib/api";
import { setPlanItemDone } from "@/lib/services/planner";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/plan-items/[id]">) => {
  const { id } = await ctx.params;
  const { done } = await body(req, z.object({ done: z.boolean() }));
  setPlanItemDone(id, done);
  return Response.json({ ok: true });
});
