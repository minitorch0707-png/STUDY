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

export const SUPPORTED_EXTENSIONS = ["pdf", "pptx", "docx", "txt", "md"] as const;
export type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];
// Lecture decks full of photos and video are often 50–200 MB; text is only a tiny part.
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250 MB per file

export interface ParseOptions {
  /** Load image bytes (only needed when the vision model will describe them). */
  withImages?: boolean;
}
