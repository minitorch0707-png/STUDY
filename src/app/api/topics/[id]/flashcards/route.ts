import { z } from "zod";
import { body, handle, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { generateDeck } from "@/lib/services/flashcards";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/flashcards">) => {
  const { id } = await ctx.params;
  rateLimit("flashcards", 10);
  const { count } = await body(req, z.object({ count: z.number().int().min(3).max(25).default(12) }));
  await requireChatModel();
  return Response.json({ deckId: generateDeck(id, count) });
});
