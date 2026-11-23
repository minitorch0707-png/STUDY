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
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB per file
