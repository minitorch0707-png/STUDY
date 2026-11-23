import { decodeXmlEntities, markdownTable } from "./xml";

/** Minimal HTML → markdown for mammoth's well-formed output (headings, lists, tables, emphasis). */
export function htmlToMarkdown(html: string): string {
  let s = html;

  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, inner: string) => {
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
      [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => inlineText(c[1])),
    );
    return `\n\n${markdownTable(rows)}\n\n`;
  });

  s = s.replace(/<img\b[^>]*src="lecturelab-image:(\d+)"[^>]*>/gi, "[image:$1]");
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${"#".repeat(Number(l))} ${inlineText(t)}\n\n`);

  // Lists (support one level of nesting)
  const list = (html: string, depth: number): string =>
    html.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/i, (_, type: string, inner: string) => {
      let n = 0;
      const items = inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, li: string) => {
        n++;
        const marker = type.toLowerCase() === "ol" ? `${n}.` : "-";
        return `\n${"  ".repeat(depth)}${marker} ${inlineText(li)}`;
      });
      return `\n${items}\n`;
    });
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = list(s, 0);
  }

  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n\n${inlineText(t)}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = decodeXmlEntities(s.replace(/<[^>]+>/g, ""));
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function inlineText(html: string): string {
  const t = html
    .replace(/<img\b[^>]*src="lecturelab-image:(\d+)"[^>]*>/gi, "[image:$1]")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(t).replace(/\s+/g, " ").replace(/\*\*\s*\*\*/g, "").trim();
}
