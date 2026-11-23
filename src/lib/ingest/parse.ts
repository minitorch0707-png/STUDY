import { parseDocx } from "./parsers/docx";
import { parsePdf } from "./parsers/pdf";
import { parsePptx } from "./parsers/pptx";
import { parseText } from "./parsers/text";
import { parsePpt } from "./parsers/ppt";
import { parseCsv, parseDoc, parseEpub, parseHtml, parseOdf, parseRtf } from "./parsers/more";
import { EXTENSION_ALIASES, MAX_UPLOAD_BYTES, type ParseOptions, type ParsedDocument, type SupportedExt } from "./types";

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

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
    key: "a Keynote file. In Keynote choose File → Export To → PowerPoint (or PDF), then upload that",
    pages: "a Pages file. In Pages choose File → Export To → Word (or PDF), then upload that",
    numbers: "a Numbers file. In Numbers choose File → Export To → CSV, then upload that",
    gslides: "only a Google Slides shortcut, not the slides themselves. In Google Slides choose File → Download → Microsoft PowerPoint (.pptx), then upload that",
    gdoc: "only a Google Docs shortcut. In Google Docs choose File → Download → Microsoft Word (.docx), then upload that",
    gsheet: "only a Google Sheets shortcut. In Google Sheets choose File → Download → CSV, then upload that",
    zip: "a zip file. Unzip it first, then upload the files inside",
    heic: "an iPhone photo (HEIC). Open it in Photos/Preview and export it as JPEG, then upload that",
    xlsx: "a spreadsheet. Save or export it as CSV, then upload that",
    xls: "a spreadsheet. Save or export it as CSV, then upload that",
    mp4: "a video. LectureLab reads slides and documents, not video yet",
    mov: "a video. LectureLab reads slides and documents, not video yet",
    mp3: "an audio file. LectureLab can't transcribe audio yet",
    m4a: "an audio file. LectureLab can't transcribe audio yet",
  };
  if (resave[ext]) return { ok: false, error: `"${filename}" is ${resave[ext]}.` };
  const kind = EXTENSION_ALIASES[ext];
  if (!kind) {
    return { ok: false, error: `"${filename}" isn't a file type LectureLab can read yet. Try PDF, PowerPoint, Word, text, web pages, e-books or photos.` };
  }
  if (buf.length === 0) return { ok: false, error: `"${filename}" is empty.` };
  if (buf.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `"${filename}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Try exporting it as PDF.` };
  }
  const head = buf.subarray(0, 12);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const bad = (what: string) => ({ ok: false as const, error: `"${filename}" doesn't look like a real ${what} file. It may be damaged, or renamed from another type.` });
  if (kind === "pdf" && buf.indexOf("%PDF-") === -1) return bad("PDF");
  if ((kind === "pptx" || kind === "docx" || kind === "odp" || kind === "odt" || kind === "epub") && !isZip) {
    if ((kind === "pptx" || kind === "docx") && head.subarray(0, 8).equals(OLE)) {
      // An old-format file with a new-format name (common after renaming). Read it as the old format.
      return { ok: true, ext: kind === "pptx" ? "ppt" : "doc" };
    }
    return bad(kind.toUpperCase());
  }
  if ((kind === "ppt" || kind === "doc") && !head.subarray(0, 8).equals(OLE)) {
    if (isZip) return { ok: true, ext: kind === "ppt" ? "pptx" : "docx" }; // new format, old name
    return bad(kind === "ppt" ? "PowerPoint" : "Word");
  }
  if (kind === "rtf" && !buf.subarray(0, 5).toString("latin1").startsWith("{\\rtf")) return bad("RTF");
  if (kind === "image") {
    const png = head[0] === 0x89 && head[1] === 0x50;
    const jpg = head[0] === 0xff && head[1] === 0xd8;
    const webp = head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
    if (!png && !jpg && !webp) return bad("image");
  }
  if (["txt", "md", "html", "csv", "tsv"].includes(kind)) {
    // Reject binary data disguised as text.
    const sample = buf.subarray(0, 4096);
    for (const b of sample) if (b === 0 || (b < 9 && b !== 0)) return { ok: false, error: `"${filename}" contains binary data, not text.` };
  }
  return { ok: true, ext: kind };
}

export async function parseDocument(ext: SupportedExt, buf: Buffer, opts: ParseOptions = {}): Promise<ParsedDocument> {
  switch (ext) {
    case "pdf":
      return parsePdf(buf);
    case "pptx":
      return parsePptx(buf, opts);
    case "ppt":
      return parsePpt(buf);
    case "docx":
      return parseDocx(buf);
    case "doc":
      return parseDoc(buf);
    case "odp":
    case "odt":
      return parseOdf(buf, ext);
    case "rtf":
      return parseRtf(buf);
    case "html":
      return parseHtml(buf);
    case "epub":
      return parseEpub(buf);
    case "csv":
    case "tsv":
      return parseCsv(buf, ext === "csv" ? "," : "\t");
    case "txt":
    case "md":
      return parseText(buf);
    case "image":
      // Photos are read by the vision model during processing (see documents.ts).
      return { sections: [{ label: "Image", title: null, content: "", hasText: false, images: [{ name: "image", mime: "image/*", data: buf }] }], warnings: [] };
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
