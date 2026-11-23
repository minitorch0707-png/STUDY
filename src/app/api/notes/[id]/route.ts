import { z } from "zod";
import { body, handle, notFound } from "@/lib/api";
import { deleteNote, getNote, updateNote } from "@/lib/services/notes";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/notes/[id]">) => {
  const { id } = await ctx.params;
  return Response.json(getNote(id) ?? notFound("Note not found"));
});
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/notes/[id]">) => {
  const { id } = await ctx.params;
  const b = await body(req, z.object({ title: z.string().max(200).optional(), content: z.string().max(200_000).optional() }));
  return Response.json(updateNote(id, b) ?? notFound());
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/notes/[id]">) => {
  const { id } = await ctx.params;
  deleteNote(id);
  return Response.json({ ok: true });
});
