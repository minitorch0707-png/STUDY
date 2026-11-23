import { getDocumentProxy } from "unpdf";
import type { ParsedDocument, ParsedSection } from "../types";

interface TextItem {
  str: string;
  transform: number[];
  height: number;
  hasEOL?: boolean;
}

/**
 * PDFs are read page by page. We rebuild lines from text positions and guess
 * each page's title from its largest text. Pages with no text layer (scans,
 * photos of handouts) are flagged honestly instead of silently skipped.
 */
export async function parsePdf(buf: Buffer): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const sections: ParsedSection[] = [];
  const warnings: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as unknown as TextItem[]).filter((it) => typeof it.str === "string");

    const lines: { text: string; height: number }[] = [];
    let current = "";
    let currentHeight = 0;
    let lastY: number | null = null;
    const flush = () => {
      const t = current.replace(/\s+/g, " ").trim();
      if (t) lines.push({ text: t, height: currentHeight });
      current = "";
      currentHeight = 0;
    };
    for (const it of items) {
      const y = it.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > Math.max(2, it.height * 0.5)) flush();
      current += it.str;
      currentHeight = Math.max(currentHeight, it.height || 0);
      lastY = y;
      if (it.hasEOL) {
        flush();
        lastY = null;
      }
    }
    flush();

    let title: string | null = null;
    if (lines.length) {
      const heights = lines.map((l) => l.height).sort((a, b) => a - b);
      const median = heights[Math.floor(heights.length / 2)] || 0;
      const top = lines.slice(0, 6).reduce((a, b) => (b.height > a.height ? b : a), lines[0]);
      if (top.height > median * 1.2 && top.text.length <= 120) title = top.text;
    }

    // Join lines into paragraphs: a line ending without punctuation followed by a
    // lowercase start is usually a wrapped sentence.
    const out: string[] = [];
    for (const l of lines) {
      if (title && l.text === title && !out.length) continue;
      const prev = out[out.length - 1];
      if (prev && !/[.:;!?)]$/.test(prev) && /^[a-z(]/.test(l.text) && !/^\s*[-•▪◦*]/.test(prev)) {
        out[out.length - 1] = `${prev} ${l.text}`;
      } else {
        out.push(l.text.replace(/^[•▪◦]\s*/, "- "));
      }
    }
    const content = out.join("\n").trim();
    sections.push({ label: `Page ${p}`, title, content, hasText: content.length > 0 || Boolean(title), images: [] });
    page.cleanup();
  }

  const noText = sections.filter((s) => !s.hasText);
  if (noText.length === sections.length && sections.length > 0) {
    warnings.push(
      "This PDF has no readable text layer — it looks scanned or image-only. LectureLab can't read it yet. Try exporting the original slides as PDF, or run OCR on it first.",
    );
  } else if (noText.length) {
    warnings.push(
      `${noText.length} page(s) had no readable text (${noText.slice(0, 6).map((s) => s.label).join(", ")}${noText.length > 6 ? "…" : ""}), probably images or scans.`,
    );
  }
  await pdf.destroy();
  return { sections, warnings };
}
