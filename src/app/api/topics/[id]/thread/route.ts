import { z } from "zod";
import { body, handle } from "@/lib/api";
import { ensureThread, updateThread } from "@/lib/services/tutor";

/** The tutor thread for a topic: unsent draft and resume position. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]/thread">) => {
  const { id } = await ctx.params;
  return Response.json(ensureThread(id));
});
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/thread">) => {
  const { id } = await ctx.params;
  const b = await body(req, z.object({ draft: z.string().max(8000).optional(), resumeMessageId: z.string().max(80).nullable().optional() }));
  return Response.json(updateThread(id, b));
});
