import { z } from "zod";
import { body, handle } from "@/lib/api";
import { createDeck, listDecks } from "@/lib/services/flashcards";

export const GET = handle((req: Request) => Response.json(listDecks(new URL(req.url).searchParams.get("course") ?? undefined)));
export const POST = handle(async (req: Request) => {
  const b = await body(req, z.object({ courseId: z.string(), title: z.string().min(1).max(120), topicId: z.string().nullable().optional() }));
  return Response.json({ id: createDeck(b.courseId, b.title, b.topicId ?? null) }, { status: 201 });
});
