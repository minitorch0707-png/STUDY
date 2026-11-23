import JSZip from "jszip";
import path from "node:path";
import type { ParsedDocument, ParsedSection } from "../types";
import { htmlToMarkdown } from "../html";
import { decodeXmlEntities, markdownTable } from "../xml";
import { splitMarkdownByHeadings } from "./text";

/** Plain text → markdown, turning tab-separated rows into tables. */
function textWithTables(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let table: string[][] = [];
  const flush = () => {
    if (table.length >= 2) out.push("", markdownTable(table), "");
    else out.push(...table.map((r) => r.join(" ")));
    table = [];
  };
  for (const l of lines) {
    const cells = l.replace(/\t$/, "").split("\t");
    if (cells.length >= 2) table.push(cells.map((c) => c.trim()));
    else {
      flush();
      out.push(l);
    }
  }
  flush();
  return out.join("\n");
}

/** Short standalone lines followed by text are treated as headings (Word files don't keep heading styles here). */
function promoteHeadings(text: string): string {
  const lines = text.split("\n");
  return lines
    .map((l, i) => {
      const t = l.trim();
      const next = lines.slice(i + 1).find((x) => x.trim());
      const looksLikeHeading = t.length >= 3 && t.length <= 70 && !/[.,;:!?)]$/.test(t) && !/^[-•*\d]/.test(t) && !t.includes("|") && next && next.trim().length > t.length && /^[A-Z0-9]/.test(t);
      return looksLikeHeading && (i === 0 || !lines[i - 1].trim()) ? `## ${t}` : l;
    })
    .join("\n");
}

// ---------------------------------------------------------------- .doc (Word 97–2003)
export async function parseDoc(buf: Buffer): Promise<ParsedDocument> {
  const { default: WordExtractor } = await import("word-extractor");
  const doc = await new WordExtractor().extract(buf);
  const body = doc.getBody() ?? "";
  const extra = [doc.getFootnotes(), doc.getEndnotes()].filter((x) => x && x.trim()).join("\n");
  const md = promoteHeadings(textWithTables(body)) + (extra ? `\n\n## Notes\n\n${extra}` : "");
  const parsed = splitMarkdownByHeadings(md, "Section");
  parsed.warnings.push("Old .doc format: text and tables were read; images are not analysed. Saving as .docx gives the best results.");
  return parsed;
}

// ---------------------------------------------------------------- RTF
const CP1252: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x84: "„", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™" };

export function rtfToText(rtf: string): string {
  const skipDest = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "object", "themedata", "colorschememapping", "datastore", "latentstyles", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "mmathPr"]);
  let out = "";
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkip = 0;
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];
    if (ch === "{") {
      stack.push({ skip, uc });
      if (rtf.startsWith("{\\*", i)) skip = true;
      continue;
    }
    if (ch === "}") {
      const s = stack.pop();
      if (s) ({ skip, uc } = s);
      continue;
    }
    if (ch === "\\") {
      const next = rtf[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (!skip) out += next;
        i++;
        continue;
      }
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (pendingSkip > 0) pendingSkip--;
        else if (!skip && !isNaN(code)) out += CP1252[code] ?? String.fromCharCode(code);
        i += 3;
        continue;
      }
      if (next === "~") {
        if (!skip) out += " ";
        i++;
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length - 1;
      const word = m[1];
      const arg = m[2] ? Number(m[2]) : null;
      if (skipDest.has(word)) skip = true;
      else if (skip) continue;
      else if (word === "par" || word === "line" || word === "sect" || word === "page") out += "\n";
      else if (word === "row") out += "\n";
      else if (word === "cell") out += "\t";
      else if (word === "tab") out += "\t";
      else if (word === "bullet") out += "•";
      else if (word === "emdash") out += "—";
      else if (word === "endash") out += "–";
      else if (word === "lquote") out += "‘";
      else if (word === "rquote") out += "’";
      else if (word === "ldblquote") out += "“";
      else if (word === "rdblquote") out += "”";
      else if (word === "uc" && arg !== null) uc = arg;
      else if (word === "u" && arg !== null) {
        out += String.fromCharCode(arg < 0 ? arg + 65536 : arg);
        pendingSkip = uc;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") continue;
    if (skip) continue;
    if (pendingSkip > 0) {
      pendingSkip--;
      continue;
    }
    out += ch;
  }
  return out.replace(/[  ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseRtf(buf: Buffer): ParsedDocument {
  return splitMarkdownByHeadings(promoteHeadings(textWithTables(rtfToText(buf.toString("latin1")))), "Section");
}

// ---------------------------------------------------------------- OpenDocument (.odt, .odp)
function odfInline(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n) => " ".repeat(Number(n ?? 1)))
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

function odfBlocks(xml: string): string {
  const out: string[] = [];
  const re = /<table:table\b[\s\S]*?<\/table:table>|<text:h\b([^>]*)>([\s\S]*?)<\/text:h>|<text:list-item\b[^>]*>([\s\S]*?)<\/text:list-item>|<text:p\b[^>]*>([\s\S]*?)<\/text:p>|<text:p\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith("<table:table")) {
      const rows = [...m[0].matchAll(/<table:table-row\b[\s\S]*?<\/table:table-row>/g)].map((r) =>
        [...r[0].matchAll(/<table:table-cell\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)].map((c) => odfInline(c[1] ?? "")),
      );
      if (rows.length) out.push("", markdownTable(rows), "");
    } else if (m[2] !== undefined) {
      const level = Math.min(3, Number(/outline-level="(\d)"/.exec(m[1] ?? "")?.[1] ?? 2));
      const t = odfInline(m[2]);
      if (t) out.push(`${"#".repeat(level)} ${t}`);
    } else if (m[3] !== undefined) {
      const t = odfInline(m[3]);
      if (t) out.push(`- ${t.replace(/\n+/g, " ")}`);
    } else if (m[4] !== undefined) {
      const t = odfInline(m[4]);
      if (t) out.push(t);
    }
  }
  return out.join("\n");
}

export async function parseOdf(buf: Buffer, kind: "odt" | "odp"): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const content = (await zip.file("content.xml")?.async("string")) ?? "";
  if (!content) throw new Error("This OpenDocument file has no content.");
  if (kind === "odt") return splitMarkdownByHeadings(odfBlocks(content), "Section");

  const sections: ParsedSection[] = [];
  const pages = [...content.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/g)];
  pages.forEach((p, i) => {
    const notesXml = /<presentation:notes\b[\s\S]*?<\/presentation:notes>/.exec(p[1])?.[0] ?? "";
    const body = p[1].replace(notesXml, "");
    const frames = [...body.matchAll(/<draw:frame\b([^>]*)>([\s\S]*?)<\/draw:frame>/g)];
    let title: string | null = null;
    const lines: string[] = [];
    for (const f of frames) {
      const text = odfBlocks(f[2]);
      if (!text) continue;
      if (!title && /presentation:class="title"/.test(f[1])) title = text.replace(/\n+/g, " ");
      else lines.push(text);
    }
    const notes = odfBlocks(notesXml) || null;
    const contentMd = lines.join("\n").trim();
    sections.push({ label: `Slide ${i + 1}`, title, content: contentMd, notes, hasText: Boolean(title || contentMd || notes), images: [] });
  });
  return { sections, warnings: sections.some((s) => !s.hasText) ? ["Some slides contain no text (probably images or diagrams)."] : [] };
}

// ---------------------------------------------------------------- HTML and EPUB
export function cleanHtml(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(div|section|article|main|span|figure|figcaption|blockquote)\b[^>]*>/gi, (m, t) => (/^(span)$/i.test(t) ? "" : "<p>"))
    .replace(/<\/(div|section|article|main|figure|figcaption|blockquote)>/gi, "</p>")
    .replace(/<\/span>/gi, "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
}

export function parseHtml(buf: Buffer): ParsedDocument {
  const html = buf.toString("utf8");
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const md = htmlToMarkdown(cleanHtml(html));
  return splitMarkdownByHeadings(title && !md.startsWith("#") ? `# ${decodeXmlEntities(title)}\n\n${md}` : md, "Section");
}

export async function parseEpub(buf: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const container = (await zip.file("META-INF/container.xml")?.async("string")) ?? "";
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) throw new Error("This EPUB file is missing its table of contents.");
  const opf = (await zip.file(opfPath)?.async("string")) ?? "";
  const base = path.posix.dirname(opfPath);
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map((m) => [/id="([^"]+)"/.exec(m[0])?.[1], /href="([^"]+)"/.exec(m[0])?.[1]]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => manifest.get(m[1])).filter((x): x is string => Boolean(x));
  const sections: ParsedSection[] = [];
  for (const href of spine) {
    const file = zip.file(path.posix.join(base, decodeURIComponent(href)));
    if (!file) continue;
    const html = await file.async("string");
    const md = htmlToMarkdown(cleanHtml(html)).trim();
    if (md.length < 40) continue; // covers, blank pages
    const title = /^#{1,3}\s+(.+)$/m.exec(md)?.[1] ?? /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
    // Long chapters are split so citations stay precise.
    const parts = splitMarkdownByHeadings(md, "Part").sections;
    for (const p of parts) sections.push({ ...p, label: `Chapter ${sections.length + 1}`, title: p.title ?? title });
  }
  sections.forEach((s, i) => (s.label = `Section ${i + 1}`));
  return { sections, warnings: sections.length ? [] : ["No readable chapters were found in this e-book (it may be DRM-protected)."] };
}

// ---------------------------------------------------------------- CSV / TSV
export function parseCsv(buf: Buffer, sep: "," | "\t"): ParsedDocument {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  if (!rows.length) return { sections: [], warnings: ["This file is empty."] };
  const header = rows[0];
  const sections: ParsedSection[] = [];
  for (let i = 1; i < Math.max(2, rows.length); i += 40) {
    const chunk = rows.slice(i, i + 40);
    sections.push({ label: `Rows ${i}–${i + chunk.length - 1}`, title: null, content: markdownTable([header, ...chunk]), hasText: true, images: [] });
  }
  return { sections, warnings: rows.length > 2000 ? ["Large spreadsheet: only the text is used; formulas and charts are ignored."] : [] };
}
