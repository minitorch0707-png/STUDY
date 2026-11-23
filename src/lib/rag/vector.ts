/**
 * Vector helpers. Embeddings are stored in SQLite as compact float32 blobs and
 * searched by cosine similarity in memory. For one student's courses (a few
 * thousand chunks) this takes milliseconds and needs no separate database
 * server. The VectorStore interface lets us move to pgvector later.
 */

export function toBlob(vec: number[]): Buffer {
  const f = new Float32Array(normalize(vec));
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function fromBlob(buf: Buffer): Float32Array {
  // Copy into an aligned buffer (SQLite blobs may not be 4-byte aligned).
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

export function normalize(vec: number[]): number[] {
  let n = 0;
  for (const v of vec) n += v * v;
  n = Math.sqrt(n) || 1;
  return vec.map((v) => v / n);
}

/** Vectors are stored normalised, so the dot product equals cosine similarity. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

export interface VectorRecord {
  id: string;
  vector: Float32Array;
}

export interface VectorStore {
  search(query: number[], limit: number): { id: string; score: number }[];
}

export class InMemoryVectorStore implements VectorStore {
  constructor(private records: VectorRecord[]) {}
  search(query: number[], limit: number) {
    const q = normalize(query);
    return this.records
      .map((r) => ({ id: r.id, score: dot(q, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/** Reciprocal Rank Fusion: merge several ranked lists without tuning weights. */
export function reciprocalRankFusion(lists: { id: string }[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, rank) => scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
