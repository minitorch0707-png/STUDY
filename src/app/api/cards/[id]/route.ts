import { z } from "zod";
import { body, handle } from "@/lib/api";
import { deleteCard, updateCard } from "@/lib/services/flashcards";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/cards/[id]">) => {
  const { id } = await ctx.params;
  const b = await body(req, z.object({ front: z.string().trim().min(1).max(1000), back: z.string().trim().min(1).max(2000) }));
  updateCard(id, b.front, b.back);
  return Response.json({ ok: true });
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/cards/[id]">) => {
  const { id } = await ctx.params;
  deleteCard(id);
  return Response.json({ ok: true });
});
