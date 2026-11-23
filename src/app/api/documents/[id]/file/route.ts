import fs from "node:fs";
import { handle, notFound } from "@/lib/api";
import { filePath, getDocument } from "@/lib/services/documents";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
};

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/documents/[id]/file">) => {
  const { id } = await ctx.params;
  const doc = getDocument(id) ?? notFound();
  const p = filePath(doc);
  if (!fs.existsSync(p)) notFound("File missing from disk");
  const inline = doc.ext === "pdf" || doc.ext === "txt" || doc.ext === "md";
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: {
      "Content-Type": TYPES[doc.ext] ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
      "X-Content-Type-Options": "nosniff",
      // Text files can't run scripts in a sandbox; PDFs need the browser's viewer, so they're not sandboxed.
      ...(doc.ext === "pdf" ? {} : { "Content-Security-Policy": "sandbox" }),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
