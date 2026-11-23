import { z } from "zod";
import { body, handle, HttpError, notFound } from "@/lib/api";
import { addUpload, deleteDocument, getDocument, getSections, updateDocument } from "@/lib/services/documents";
import { parseJson } from "@/lib/db";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const { id } = await ctx.params;
  const doc = getDocument(id) ?? notFound("Document not found");
  return Response.json({ document: { ...doc, warnings: parseJson(doc.warnings, []) }, sections: getSections(id) });
});
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const { id } = await ctx.params;
  const patch = await body(
    req,
    z.object({
      display_name: z.string().max(200).optional(),
      kind: z.enum(["lecture", "syllabus", "reading", "notes", "other"]).optional(),
      week: z.number().int().min(0).max(60).nullable().optional(),
      lecture_label: z.string().max(60).nullable().optional(),
    }),
  );
  return Response.json(updateDocument(id, patch) ?? notFound());
});
/** Replace the file (keeps its place in the course; reprocesses content). */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const { id } = await ctx.params;
  const doc = getDocument(id) ?? notFound();
  const f = (await req.formData()).get("file");
  if (!(f instanceof File)) throw new HttpError(400, "No file received");
  return Response.json(addUpload(doc.course_id, f.name, Buffer.from(await f.arrayBuffer()), id));
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const { id } = await ctx.params;
  deleteDocument(id);
  return Response.json({ ok: true });
});
