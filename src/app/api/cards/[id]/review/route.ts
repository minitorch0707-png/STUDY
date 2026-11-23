import { z } from "zod";
import { body, handle } from "@/lib/api";
import { reviewCard } from "@/lib/services/flashcards";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/cards/[id]/review">) => {
  const { id } = await ctx.params;
  const b = await body(req, z.object({ rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), durationMs: z.number().int().min(0).max(3_600_000).optional() }));
  return Response.json(reviewCard(id, b.rating, b.durationMs));
});
