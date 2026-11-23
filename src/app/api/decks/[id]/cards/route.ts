import { z } from "zod";
import { body, handle } from "@/lib/api";
import { addCard } from "@/lib/services/flashcards";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/decks/[id]/cards">) => {
  const { id } = await ctx.params;
  const b = await body(req, z.object({ front: z.string().trim().min(1).max(1000), back: z.string().trim().min(1).max(2000) }));
  return Response.json({ id: addCard(id, b.front, b.back) }, { status: 201 });
});
