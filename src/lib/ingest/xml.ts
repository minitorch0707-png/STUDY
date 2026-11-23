export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

export function allMatches(re: RegExp, s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(s))) out.push(m);
  return out;
}

export function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXmlEntities(m[1]) : null;
}

/** Escape pipes so cell text can't break a markdown table. */
export const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

export function markdownTable(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  if (!rows.length || width === 0) return "";
  const norm = rows.map((r) => [...r, ...Array(width - r.length).fill("")].map(mdCell));
  const header = `| ${norm[0].join(" | ")} |`;
  const sep = `| ${Array(width).fill("---").join(" | ")} |`;
  return [header, sep, ...norm.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n");
}
