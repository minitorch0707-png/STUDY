import { z } from "zod";
import { body, handle } from "@/lib/api";
import { rateGeneration } from "@/lib/services/generations";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/generations/[id]">) => {
  const { id } = await ctx.params;
  const { rating } = await body(req, z.object({ rating: z.union([z.literal(1), z.literal(-1), z.null()]) }));
  rateGeneration(id, rating);
  return Response.json({ ok: true });
});
