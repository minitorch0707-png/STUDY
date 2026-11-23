import JSZip from "jszip";
import path from "node:path";
import type { ParsedDocument, ParsedSection, ExtractedImage, ParseOptions } from "../types";
import { allMatches, attr, decodeXmlEntities, markdownTable } from "../xml";

/**
 * PowerPoint files are zip archives of XML. We read slides in presentation
 * order, keep titles, bullet levels, tables and speaker notes, and collect the
 * slide's images (for the optional vision model).
 */

function relsMap(xml: string | undefined): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  if (!xml) return map;
  for (const m of allMatches(/<Relationship\b[^>]*\/?>/, xml)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    const type = attr(m[0], "Type") ?? "";
    if (id && target) map.set(id, { target, type });
  }
  return map;
}

function paragraphText(pXml: string): string {
  const parts: string[] = [];
  for (const m of allMatches(/<a:t>([\s\S]*?)<\/a:t>|<a:t\/>|<a:br\/>|<a:tab\/>/, pXml)) {
    if (m[0] === "<a:br/>") parts.push("\n");
    else if (m[0] === "<a:tab/>") parts.push("\t");
    else parts.push(decodeXmlEntities(m[1] ?? ""));
  }
  return parts.join("").replace(/[ \t]+/g, " ").trim();
}

function shapeParagraphs(xml: string): { text: string; level: number; bullet: boolean }[] {
  const out: { text: string; level: number; bullet: boolean }[] = [];
  for (const p of allMatches(/<a:p>([\s\S]*?)<\/a:p>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/, xml)) {
    const inner = p[1] ?? p[2] ?? "";
    const text = paragraphText(inner);
    if (!text) continue;
    const pPr = /<a:pPr\b[^>]*>/.exec(inner)?.[0] ?? "";
    const level = Number(attr(pPr, "lvl") ?? 0);
    const bullet = !/<a:buNone\/>/.test(inner);
    out.push({ text, level, bullet });
  }
  return out;
}

function tableMarkdown(frameXml: string): string {
  const rows: string[][] = [];
  for (const tr of allMatches(/<a:tr\b[\s\S]*?<\/a:tr>/, frameXml)) {
    const cells = allMatches(/<a:tc\b[\s\S]*?<\/a:tc>/, tr[0]).map((tc) =>
      shapeParagraphs(tc[0]).map((p) => p.text).join(" "),
    );
    rows.push(cells);
  }
  return rows.length ? markdownTable(rows) : "";
}

function resolveTarget(fromFile: string, target: string) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
}

export async function parsePptx(buf: Buffer, opts: ParseOptions = {}): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const read = (p: string) => zip.file(p)?.async("string");
  const warnings: string[] = [];

  const presXml = (await read("ppt/presentation.xml")) ?? "";
  const presRels = relsMap(await read("ppt/_rels/presentation.xml.rels"));
  let slideFiles = allMatches(/<p:sldId\b[^>]*>/, presXml)
    .map((m) => attr(m[0], "r:id"))
    .map((rid) => (rid ? presRels.get(rid)?.target : undefined))
    .filter((t): t is string => Boolean(t))
    .map((t) => resolveTarget("ppt/presentation.xml", t));
  if (!slideFiles.length) {
    // Fallback: numeric order of slideN.xml
    slideFiles = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
  }

  const sections: ParsedSection[] = [];
  let i = 0;
  for (const file of slideFiles) {
    i++;
    const xml = (await read(file)) ?? "";
    const relsPath = file.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
    const rels = relsMap(await read(relsPath));

    let title: string | null = null;
    const body: string[] = [];
    for (const m of allMatches(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/, xml)) {
      const shape = m[0];
      if (shape.startsWith("<p:graphicFrame")) {
        const t = tableMarkdown(shape);
        if (t) body.push(t);
        continue;
      }
      const ph = /<p:ph\b[^>]*>/.exec(shape)?.[0] ?? "";
      const phType = attr(ph, "type");
      if (phType === "sldNum" || phType === "dt" || phType === "ftr") continue;
      const paras = shapeParagraphs(shape);
      if (!paras.length) continue;
      if ((phType === "title" || phType === "ctrTitle") && !title) {
        title = paras.map((p) => p.text).join(" ");
        continue;
      }
      const isBodyList = phType === "body" || phType === null || phType === "obj";
      for (const p of paras) {
        const indent = "  ".repeat(Math.min(p.level, 4));
        body.push(isBodyList && p.bullet && paras.length > 1 ? `${indent}- ${p.text}` : `${indent}${p.text}`);
      }
    }

    // Speaker notes
    let notes: string | null = null;
    for (const r of rels.values()) {
      if (r.type.endsWith("/notesSlide")) {
        const nxml = (await read(resolveTarget(file, r.target))) ?? "";
        const parts: string[] = [];
        for (const m of allMatches(/<p:sp\b[\s\S]*?<\/p:sp>/, nxml)) {
          const ph = attr(/<p:ph\b[^>]*>/.exec(m[0])?.[0] ?? "", "type");
          if (ph === "sldNum" || ph === "sldImg") continue;
          parts.push(...shapeParagraphs(m[0]).map((p) => p.text));
        }
        notes = parts.join("\n").trim() || null;
      }
    }

    // Images on this slide
    const images: ExtractedImage[] = [];
    for (const r of rels.values()) {
      if (!r.type.endsWith("/image")) continue;
      const p = resolveTarget(file, r.target);
      const f = zip.file(p);
      if (!f) continue;
      const ext = path.extname(p).slice(1).toLowerCase();
      if (!["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) continue;
      // Image bytes are only read when they'll be described; otherwise we just count them (saves memory on big decks).
      const data = opts.withImages ? Buffer.from(await f.async("uint8array")) : Buffer.alloc(0);
      images.push({ name: path.basename(p), mime: `image/${ext === "jpg" ? "jpeg" : ext}`, data });
    }

    const content = body.join("\n").trim();
    sections.push({
      label: `Slide ${i}`,
      title,
      content: content || (title ? "" : ""),
      notes,
      hasText: Boolean(content || title || notes),
      images,
    });
  }

  const empty = sections.filter((s) => !s.hasText);
  if (empty.length) {
    warnings.push(
      `${empty.length} slide(s) contain no text (${empty.slice(0, 6).map((s) => s.label).join(", ")}${empty.length > 6 ? "…" : ""}). They may be images or diagrams only.`,
    );
  }
  const imageSlides = sections.filter((s) => s.images.length).length;
  if (imageSlides) warnings.push(`${imageSlides} slide(s) include images or diagrams. Their text was not read unless a vision model is enabled.`);
  return { sections, warnings };
}
