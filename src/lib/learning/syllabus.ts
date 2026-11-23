/**
 * Finds exam dates, deadlines, readings and grade weights in syllabus text
 * WITHOUT AI — plain pattern matching, so it's fast, free and predictable.
 * Everything it finds is shown to the student to confirm before it's used.
 */

export interface DetectedDate {
  title: string;
  kind: "exam" | "assignment" | "reading" | "other";
  date: string; // YYYY-MM-DD
  weight: number | null;
  sourceText: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DATE_PATTERNS: { re: RegExp; parse: (m: RegExpExecArray, year: number) => [number, number, number] | null }[] = [
  // October 20, 2026 / Oct. 20 / Oct 20th 2026
  { re: new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "gi"), parse: (m, y) => [Number(m[3] ?? y), MONTHS[m[1].toLowerCase().replace(".", "")], Number(m[2])] },
  // 20 October 2026
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?`, "gi"), parse: (m, y) => [Number(m[3] ?? y), MONTHS[m[2].toLowerCase().replace(".", "")], Number(m[1])] },
  // 2026-10-20
  { re: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, parse: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
];

const KIND_RULES: { kind: DetectedDate["kind"]; re: RegExp; title: (line: string) => string }[] = [
  { kind: "exam", re: /\b(final exam|midterm|mid-term|final examination|exam|test|quiz)\b/i, title: (l) => titleFrom(l, /\b(final exam(?:ination)?|mid-?term(?: exam)?|exam|test|quiz)\b/i) },
  { kind: "assignment", re: /\b(assignment|essay|paper|project|report|due|submission|presentation|lab)\b/i, title: (l) => titleFrom(l, /\b(research essay|essay|assignment\s*\d*|paper|project|report|presentation|lab\s*\d*)\b/i) },
  { kind: "reading", re: /\b(reading|read|chapter|ch\.)\b/i, title: (l) => titleFrom(l, /\b(chapter\s*\d+|ch\.\s*\d+|reading)\b/i) },
];

function titleFrom(line: string, re: RegExp): string {
  const m = re.exec(line);
  if (!m) return line.slice(0, 60);
  const w = m[0];
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function iso(y: number, mo: number, d: number): string | null {
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

export function detectDates(text: string, defaultYear = new Date().getFullYear()): DetectedDate[] {
  const yearMatch = /\b(?:fall|autumn|winter|spring|summer)\s+(20\d{2})\b/i.exec(text) ?? /\b(20\d{2})\b/.exec(text);
  const year = yearMatch ? Number(yearMatch[1]) : defaultYear;
  const out: DetectedDate[] = [];
  const seen = new Set<string>();

  // Table rows are joined into one line, so "| Midterm Exam | 30% | October 20 |" works.
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    for (const p of DATE_PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(line))) {
        const parts = p.parse(m, year);
        const date = parts && iso(...parts);
        if (!date) continue;
        const rule = KIND_RULES.find((r) => r.re.test(line));
        if (!rule) continue; // a bare date with no context isn't useful
        const title = rule.title(line);
        const key = `${title.toLowerCase()}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const weight = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(line);
        out.push({ title, kind: rule.kind, date, weight: weight ? Number(weight[1]) : null, sourceText: line.slice(0, 240) });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Which question formats the syllabus says the exams use. */
export function detectExamFormat(text: string): string[] {
  const t = text.toLowerCase();
  const formats: string[] = [];
  if (/multiple[- ]choice/.test(t)) formats.push("mcq");
  if (/true\s*(?:\/|or)\s*false/.test(t)) formats.push("true_false");
  if (/short[- ]answer/.test(t)) formats.push("short_answer");
  if (/\bessays?\b/.test(t)) formats.push("essay");
  if (/case stud|problem question|scenario|hypothetical|fact pattern/.test(t)) formats.push("scenario");
  if (/definitions?\b|terminology/.test(t)) formats.push("definition");
  if (/matching/.test(t)) formats.push("matching");
  return formats;
}

export function looksLikeSyllabus(text: string): boolean {
  const t = text.toLowerCase();
  const signals = ["syllabus", "office hours", "grading", "assessment", "course outline", "learning outcomes", "final exam", "midterm", "late policy", "weighting"];
  return signals.filter((s) => t.includes(s)).length >= 3;
}
