import { handle, HttpError, notFound, rateLimit } from "@/lib/api";
import { getCourse } from "@/lib/services/courses";
import { addUpload } from "@/lib/services/documents";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/courses/[id]/documents">) => {
  const { id } = await ctx.params;
  if (!getCourse(id)) notFound("Course not found");
  rateLimit("upload", 120);
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "No files received");
  if (files.length > 30) throw new HttpError(400, "Upload at most 30 files at a time");
  const results = [];
  for (const f of files) results.push(addUpload(id, f.name, Buffer.from(await f.arrayBuffer())));
  return Response.json({ results });
});
