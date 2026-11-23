import type { ParsedDocument, ParsedSection } from "../types";

/**
 * Split markdown/plain text into sections at headings. Without headings, text is
 * grouped into ~1,500-character parts on paragraph boundaries.
 */
export function splitMarkdownByHeadings(md: string, labelPrefix = "Section"): ParsedDocument {
  const text = md.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  const sections: ParsedSection[] = [];
  const lines = text.split("\n");
  const hasHeadings = lines.some((l) => /^#{1,3}\s+\S/.test(l));

  if (hasHeadings) {
    let title: string | null = null;
    let buf: string[] = [];
    const push = () => {
      const content = buf.join("\n").trim();
      if (content || title) sections.push({ label: "", title, content, hasText: true, images: [] });
      buf = [];
    };
    for (const line of lines) {
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        push();
        title = h[2].replace(/\*\*/g, "").trim();
      } else buf.push(line);
    }
    push();
  } else {
    const paras = text.split(/\n\s*\n/);
    let buf = "";
    for (const p of paras) {
      if (buf && buf.length + p.length > 1500) {
        sections.push({ label: "", title: null, content: buf.trim(), hasText: true, images: [] });
        buf = "";
      }
      buf += (buf ? "\n\n" : "") + p;
    }
    if (buf.trim()) sections.push({ label: "", title: null, content: buf.trim(), hasText: true, images: [] });
  }

  // Merge tiny heading-only sections into the next one to keep context together.
  const merged: ParsedSection[] = [];
  for (const s of sections) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.content && prev.title) {
      prev.content = s.title ? `### ${s.title}\n\n${s.content}` : s.content;
      continue;
    }
    merged.push(s);
  }
  merged.forEach((s, i) => (s.label = `${labelPrefix} ${i + 1}`));
  return { sections: merged, warnings: merged.length ? [] : ["This file appears to be empty."] };
}

export function parseText(buf: Buffer): ParsedDocument {
  return splitMarkdownByHeadings(buf.toString("utf8"), "Part");
}
