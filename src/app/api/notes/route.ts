import { z } from "zod";
import { body, handle } from "@/lib/api";
import { createNote, listNotes } from "@/lib/services/notes";

export const GET = handle((req: Request) => {
  const p = new URL(req.url).searchParams;
  return Response.json(listNotes({ courseId: p.get("course") ?? undefined, q: p.get("q") ?? undefined }));
});
export const POST = handle(async (req: Request) => {
  const b = await body(req, z.object({ courseId: z.string(), title: z.string().max(200).default("Untitled note"), content: z.string().max(200_000).optional(), topicId: z.string().nullable().optional() }));
  return Response.json(createNote(b), { status: 201 });
});
