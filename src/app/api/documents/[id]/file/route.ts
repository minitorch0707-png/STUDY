import fs from "node:fs";
import { handle, notFound } from "@/lib/api";
import { filePath, getDocument } from "@/lib/services/documents";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odp: "application/vnd.oasis.opendocument.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  tsv: "text/plain; charset=utf-8",
  html: "application/octet-stream", // never rendered inline (could contain scripts)
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/documents/[id]/file">) => {
  const { id } = await ctx.params;
  const doc = getDocument(id) ?? notFound();
  const p = filePath(doc);
  if (!fs.existsSync(p)) notFound("File missing from disk");
  const realExt = doc.ext === "image" ? (doc.original_name.split(".").pop() ?? "").toLowerCase() : doc.ext;
  const inline = ["pdf", "txt", "md", "csv", "tsv", "image"].includes(doc.ext);
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: {
      "Content-Type": TYPES[realExt] ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
      "X-Content-Type-Options": "nosniff",
      // Text files can't run scripts in a sandbox; PDFs need the browser's viewer, so they're not sandboxed.
      ...(doc.ext === "pdf" ? {} : { "Content-Security-Policy": "sandbox" }),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
