/**
 * BM25 keyword search — the classic search-engine ranking formula. It needs no
 * AI model, so search keeps working even while Ollama is off, and it catches
 * exact terms (case names, section numbers, formulas) that embeddings can miss.
 */

const STOP = new Set(
  "a an and are as at be but by for from has have he her his i if in into is it its of on or our she so than that the their them then there these they this to was we were what when where which who why will with you your not no do does did can could should would about also more most such only other some any each how all".split(
    " ",
  ),
);

function stem(w: string): string {
  if (w.length <= 4) return w;
  return w
    .replace(/(ational|tional)$/, "tion")
    .replace(/(iveness|fulness|ousness)$/, (m) => m.slice(0, m.length - 4))
    .replace(/(ies)$/, "y")
    .replace(/(ing|edly|ed|ly|es|s)$/, "")
    .replace(/(ment|ness)$/, "");
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [])
    .filter((t) => !STOP.has(t) && (t.length > 1 || /\d/.test(t)))
    .map(stem);
}

export interface BM25Doc {
  id: string;
  text: string;
}

export class BM25Index {
  private docs: { id: string; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(docs: BM25Doc[], private k1 = 1.4, private b = 0.75) {
    let total = 0;
    for (const d of docs) {
      const toks = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len: toks.length });
      total += toks.length;
    }
    this.avgLen = docs.length ? total / docs.length : 0;
  }

  search(query: string, limit = 20): { id: string; score: number }[] {
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    const N = this.docs.length;
    const out: { id: string; score: number }[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += (idf * (f * (this.k1 + 1))) / (f + this.k1 * (1 - this.b + (this.b * d.len) / (this.avgLen || 1)));
      }
      if (score > 0) out.push({ id: d.id, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
