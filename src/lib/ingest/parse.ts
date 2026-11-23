import { parseDocx } from "./parsers/docx";
import { parsePdf } from "./parsers/pdf";
import { parsePptx } from "./parsers/pptx";
import { parseText } from "./parsers/text";
import { MAX_UPLOAD_BYTES, SUPPORTED_EXTENSIONS, type ParseOptions, type ParsedDocument, type SupportedExt } from "./types";

export function extensionOf(filename: string): string {
  return (filename.split(".").pop() ?? "").toLowerCase();
}

/**
 * Validate an upload by extension AND by its actual bytes, so a renamed
 * executable or random file can't sneak in as "notes.pdf".
 */
export function validateUpload(filename: string, buf: Buffer): { ok: true; ext: SupportedExt } | { ok: false; error: string } {
  const ext = extensionOf(filename);
  const resave: Record<string, string> = {
    ppt: "an old PowerPoint file (.ppt). Open it in PowerPoint or Keynote and choose File → Save As / Export → .pptx, then upload that",
    doc: "an old Word file (.doc). Open it in Word or Pages and save it as .docx, then upload that",
    key: "a Keynote file. In Keynote choose File → Export To → PowerPoint (or PDF), then upload that",
    pages: "a Pages file. In Pages choose File → Export To → Word (or PDF), then upload that",
    odp: "an OpenDocument presentation. Save it as .pptx or PDF, then upload that",
    gslides: "only a Google Slides shortcut, not the slides themselves. In Google Slides choose File → Download → Microsoft PowerPoint (.pptx), then upload that",
    gdoc: "only a Google Docs shortcut. In Google Docs choose File → Download → Microsoft Word (.docx), then upload that",
    zip: "a zip file. Unzip it first, then upload the files inside",
  };
  if (resave[ext]) return { ok: false, error: `"${filename}" is ${resave[ext]}.` };
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: `"${filename}" isn't supported. Upload PDF, PowerPoint (.pptx), Word (.docx), or text (.txt, .md) files.` };
  }
  if (buf.length === 0) return { ok: false, error: `"${filename}" is empty.` };
  if (buf.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `"${filename}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  }
  const head = buf.subarray(0, 8);
  if (ext === "pdf" && !head.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return { ok: false, error: `"${filename}" doesn't look like a real PDF file.` };
  }
  if ((ext === "pptx" || ext === "docx") && !(head[0] === 0x50 && head[1] === 0x4b)) {
    return {
      ok: false,
      error: `"${filename}" isn't a valid ${ext.toUpperCase()} file. Older .ppt/.doc files must be re-saved as .pptx/.docx.`,
    };
  }
  if (ext === "txt" || ext === "md") {
    // Reject binary data disguised as text.
    const sample = buf.subarray(0, 4096);
    let ctrl = 0;
    for (const b of sample) if (b === 0 || (b < 9 && b !== 0)) ctrl++;
    if (ctrl > 0) return { ok: false, error: `"${filename}" contains binary data, not text.` };
  }
  return { ok: true, ext: ext as SupportedExt };
}

export async function parseDocument(ext: SupportedExt, buf: Buffer, opts: ParseOptions = {}): Promise<ParsedDocument> {
  switch (ext) {
    case "pdf":
      return parsePdf(buf);
    case "pptx":
      return parsePptx(buf, opts);
    case "docx":
      return parseDocx(buf);
    case "txt":
    case "md":
      return parseText(buf);
  }
}

/** Guess document type and week/lecture number from the filename. */
export function guessMetadata(filename: string): { kind: string; week: number | null; lecture: string | null } {
  const name = filename.replace(/\.[^.]+$/, "");
  const lower = name.toLowerCase();
  let kind = "lecture";
  if (/syllab|course (outline|info)|outline|course guide/.test(lower)) kind = "syllabus";
  else if (/reading|chapter|ch\.?\s?\d|article|paper/.test(lower)) kind = "reading";
  else if (/notes?\b/.test(lower) && !/lecture/.test(lower)) kind = "notes";
  const week = /\b(?:week|wk|w)[\s_-]?(\d{1,2})\b/i.exec(name)?.[1];
  const lec = /\b(?:lecture|lec|l)[\s_-]?(\d{1,2})\b/i.exec(name)?.[1];
  return { kind, week: week ? Number(week) : null, lecture: lec ? `Lecture ${Number(lec)}` : null };
}
