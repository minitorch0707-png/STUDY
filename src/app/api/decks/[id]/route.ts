import { handle, notFound } from "@/lib/api";
import { deckCards, deleteDeck, listDecks } from "@/lib/services/flashcards";
import { db } from "@/lib/db";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/decks/[id]">) => {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT course_id FROM decks WHERE id = ?").get(id) as { course_id: string } | undefined;
  if (!row) notFound("Deck not found");
  const deck = listDecks(row.course_id).find((d) => d.id === id);
  return Response.json({ deck, cards: deckCards(id) });
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/decks/[id]">) => {
  const { id } = await ctx.params;
  deleteDeck(id);
  return Response.json({ ok: true });
});
