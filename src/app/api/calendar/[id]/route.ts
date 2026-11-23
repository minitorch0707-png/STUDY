import { z } from "zod";
import { body, handle } from "@/lib/api";
import { deleteEvent, updateEvent } from "@/lib/services/planner";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/calendar/[id]">) => {
  const { id } = await ctx.params;
  updateEvent(
    id,
    await body(
      req,
      z.object({
        title: z.string().min(1).max(120).optional(),
        kind: z.enum(["exam", "assignment", "reading", "other"]).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        weight: z.number().min(0).max(100).nullable().optional(),
        confirmed: z.boolean().optional(),
      }),
    ),
  );
  return Response.json({ ok: true });
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/calendar/[id]">) => {
  const { id } = await ctx.params;
  deleteEvent(id);
  return Response.json({ ok: true });
});
