/**
 * Citation checks for AI answers (pure functions, used on the server and in the
 * browser).
 *
 * - A citation like [S3] is only "verified" if source 3 was actually given to
 *   the model for this answer. Anything else is shown as an uncertain source.
 * - A substantial paragraph or bullet with no citation, which isn't labelled
 *   "Beyond your materials", is marked as uncertain so students double-check it.
 */

const CITE = /\[(S\d+(?:\s*,\s*S?\d+)*)\]/;
const CITE_ALL = new RegExp(CITE.source, "g");
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

export function citedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(CITE_ALL)) for (const p of m[1].split(/\s*,\s*/)) out.push(Number(p.replace(/^S/, "")));
  return out;
}

function isClaim(line: string): boolean {
  const plain = line.replace(LIST_ITEM, "").replace(/[*_`>#]/g, "").trim();
  if (plain.length < 60) return false; // short labels, greetings, one-liners
  if (/^\s*#{1,6}\s/.test(line)) return false;
  if (/\?\s*$/.test(plain)) return false; // questions back to the student
  if (/^beyond your materials/i.test(plain)) return false;
  if (/^(quick check|try this|your turn|recap)\b/i.test(plain)) return false;
  return true;
}

type Part = { text: string; check: boolean; isList: boolean };

/** Split markdown into paragraphs, marking which can be checked (not code, tables or "beyond" notes). */
function parts(text: string): Part[] {
  const out: Part[] = [];
  let inFence = false;
  for (const para of text.split(/\n{2,}/)) {
    const fences = (para.match(/```/g) ?? []).length;
    const touchesFence = inFence || fences > 0;
    if (fences % 2 === 1) inFence = !inFence;
    const lines = para.split("\n");
    const check = !touchesFence && !lines.some((l) => /^\s*\|/.test(l)) && !/^\s*\**beyond your materials/i.test(para);
    out.push({ text: para, check, isList: lines.every((l) => LIST_ITEM.test(l) || !l.trim()) });
  }
  return out;
}

export interface Verification {
  cited: number[];
  invalid: number[];
  uncertainBlocks: number;
  blocks: number;
}

export function verifyCitations(text: string, sourceCount: number): Verification {
  const nums = citedNumbers(text);
  const cited = [...new Set(nums.filter((n) => n >= 1 && n <= sourceCount))].sort((a, b) => a - b);
  const invalid = [...new Set(nums.filter((n) => n < 1 || n > sourceCount))].sort((a, b) => a - b);
  let blocks = 0;
  let uncertainBlocks = 0;
  for (const p of parts(text)) {
    if (!p.check) continue;
    const units = p.isList ? p.text.split("\n").filter((l) => l.trim()) : [p.text];
    for (const u of units) {
      blocks++;
      if (isClaim(u) && !CITE.test(u)) uncertainBlocks++;
    }
  }
  return { cited, invalid, uncertainBlocks, blocks };
}

/** Adds an `[?](#uncertain)` marker to uncited claims so the renderer can flag them. */
export function markUncertain(text: string): string {
  return parts(text)
    .map((p) => {
      if (!p.check) return p.text;
      if (p.isList) return p.text.split("\n").map((l) => (isClaim(l) && !CITE.test(l) ? `${l} [?](#uncertain)` : l)).join("\n");
      return isClaim(p.text) && !CITE.test(p.text) ? `${p.text} [?](#uncertain)` : p.text;
    })
    .join("\n\n");
}
