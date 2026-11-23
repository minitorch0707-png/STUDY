/** A problem the student can fix themselves; its message is shown as-is. */
export class FriendlyError extends Error {}

export interface ExtractedImage {
  name: string;
  mime: string;
  data: Buffer;
}

export interface ParsedSection {
  label: string; // "Slide 4", "Page 2", "Section 3"
  title: string | null;
  content: string; // markdown
  notes?: string | null;
  hasText: boolean;
  images: ExtractedImage[];
}

export interface ParsedDocument {
  sections: ParsedSection[];
  warnings: string[];
}

/** The formats LectureLab can read (stored as documents.ext). */
export const SUPPORTED_EXTENSIONS = ["pdf", "pptx", "ppt", "docx", "doc", "odp", "odt", "rtf", "txt", "md", "html", "epub", "csv", "tsv", "image"] as const;
export type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];

/** File extensions students actually have → the reader that handles them. */
export const EXTENSION_ALIASES: Record<string, SupportedExt> = {
  pdf: "pdf",
  pptx: "pptx", pptm: "pptx", ppsx: "pptx", ppsm: "pptx", potx: "pptx", potm: "pptx",
  ppt: "ppt", pps: "ppt", pot: "ppt",
  docx: "docx", docm: "docx", dotx: "docx", dotm: "docx",
  doc: "doc", dot: "doc",
  odp: "odp", otp: "odp",
  odt: "odt", ott: "odt",
  rtf: "rtf",
  txt: "txt", text: "txt", log: "txt",
  md: "md", markdown: "md",
  html: "html", htm: "html", xhtml: "html",
  epub: "epub",
  csv: "csv", tsv: "tsv",
  png: "image", jpg: "image", jpeg: "image", webp: "image",
};

/** Short list for the uploader hint. */
export const FORMAT_SUMMARY = "PowerPoint (.pptx, .ppt), PDF, Word (.docx, .doc), notes, photos and more";
// Lecture decks full of photos and video are often 50–200 MB; text is only a tiny part.
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250 MB per file

export interface ParseOptions {
  /** Load image bytes (only needed when the vision model will describe them). */
  withImages?: boolean;
}
