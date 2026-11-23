import { handle } from "@/lib/api";
import { reviewQueue } from "@/lib/services/flashcards";

export const GET = handle((req: Request) => {
  const p = new URL(req.url).searchParams;
  return Response.json(
    reviewQueue({ courseId: p.get("course") ?? undefined, deckId: p.get("deck") ?? undefined, topicId: p.get("topic") ?? undefined, includeNotDue: p.get("all") === "1" }),
  );
});
