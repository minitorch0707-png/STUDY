import "server-only";
import { db } from "@/lib/db";
import { getEmbedder, getStatus } from "@/lib/ai";
import { sanitizeSourceText } from "@/lib/ai/text";
import { BM25Index } from "./bm25";
import { InMemoryVectorStore, fromBlob, reciprocalRankFusion } from "./vector";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  sectionId: string;
  sectionIdx: number;
  sectionLabel: string;
  sectionTitle: string | null;
  text: string;
  score: number;
}

/** What the UI receives for each [S#] citation. */
export interface SourceRef {
  n: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  sectionIdx: number;
  sectionLabel: string;
  sectionTitle: string | null;
  excerpt: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  section_id: string;
  text: string;
  embedding: Buffer | null;
  embedding_model: string | null;
  display_name: string;
  idx: number;
  label: string;
  title: string | null;
}

// Indexes are cached per course and rebuilt only when the course's chunks change.
const cache = new Map<string, { stamp: string; rows: ChunkRow[]; bm25: BM25Index; vectors: Map<string, InMemoryVectorStore> }>();

function courseStamp(courseId: string) {
  const r = db()
    .prepare("SELECT COUNT(*) n, COUNT(embedding) e, MAX(d.updated_at) u FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.course_id = ?")
    .get(courseId) as { n: number; e: number; u: string | null };
  return `${r.n}|${r.e}|${r.u}`;
}

function loadIndex(courseId: string) {
  const stamp = courseStamp(courseId);
  const hit = cache.get(courseId);
  if (hit && hit.stamp === stamp) return hit;
  const rows = db()
    .prepare(
      `SELECT c.id, c.document_id, c.section_id, c.text, c.embedding, c.embedding_model, d.display_name, s.idx, s.label, s.title
       FROM chunks c JOIN documents d ON d.id = c.document_id JOIN sections s ON s.id = c.section_id
       WHERE c.course_id = ? AND d.status != 'failed'`,
    )
    .all(courseId) as ChunkRow[];
  const bm25 = new BM25Index(rows.map((r) => ({ id: r.id, text: `${r.title ?? ""} ${r.display_name} ${r.text}` })));
  const byModel = new Map<string, { id: string; vector: Float32Array }[]>();
  for (const r of rows) {
    if (!r.embedding || !r.embedding_model) continue;
    const list = byModel.get(r.embedding_model) ?? [];
    list.push({ id: r.id, vector: fromBlob(r.embedding) });
    byModel.set(r.embedding_model, list);
  }
  const vectors = new Map([...byModel].map(([m, recs]) => [m, new InMemoryVectorStore(recs)]));
  const entry = { stamp, rows, bm25, vectors };
  cache.set(courseId, entry);
  return entry;
}

export interface RetrieveOptions {
  courseId: string;
  query: string;
  limit?: number;
  /** Sections that belong to the current topic get a boost. */
  preferSectionIds?: string[];
  documentIds?: string[];
}

/**
 * Hybrid retrieval: keyword (BM25) + meaning (embeddings) merged with
 * Reciprocal Rank Fusion. Falls back to keyword-only if embeddings are
 * unavailable, so the app degrades gracefully instead of failing.
 */
export async function retrieve(opts: RetrieveOptions): Promise<{ chunks: RetrievedChunk[]; mode: "hybrid" | "keyword" }> {
  const { courseId, query, limit = 6 } = opts;
  const idx = loadIndex(courseId);
  if (!idx.rows.length) return { chunks: [], mode: "keyword" };
  const allowed = opts.documentIds?.length ? new Set(opts.documentIds) : null;
  const rowById = new Map(idx.rows.map((r) => [r.id, r]));
  const keep = (id: string) => !allowed || allowed.has(rowById.get(id)!.document_id);

  const lists: { id: string }[][] = [idx.bm25.search(query, 40).filter((r) => keep(r.id))];
  let mode: "hybrid" | "keyword" = "keyword";

  const embedder = getEmbedder();
  const store = idx.vectors.get(embedder.model);
  if (store) {
    try {
      const st = await getStatus();
      if (st.reachable && st.embeddingModel.installed) {
        const [q] = await embedder.embed([query], "query");
        lists.push(store.search(q, 40).filter((r) => keep(r.id)));
        mode = "hybrid";
      }
    } catch {
      /* keyword-only fallback */
    }
  }

  if (opts.preferSectionIds?.length) {
    const prefer = new Set(opts.preferSectionIds);
    lists.push(idx.rows.filter((r) => prefer.has(r.section_id) && keep(r.id)).map((r) => ({ id: r.id })));
  }

  const fused = reciprocalRankFusion(lists).slice(0, limit);
  const chunks = fused.map(({ id, score }) => {
    const r = rowById.get(id)!;
    return {
      chunkId: r.id,
      documentId: r.document_id,
      documentName: r.display_name,
      sectionId: r.section_id,
      sectionIdx: r.idx,
      sectionLabel: r.label,
      sectionTitle: r.title,
      text: r.text,
      score,
    };
  });
  return { chunks, mode };
}

/** Load specific chunks (e.g. the sources behind a question being re-generated). */
export function chunksByIds(ids: string[]): RetrievedChunk[] {
  if (!ids.length) return [];
  const rows = db()
    .prepare(
      `SELECT c.id, c.document_id, c.section_id, c.text, d.display_name, s.idx, s.label, s.title
       FROM chunks c JOIN documents d ON d.id = c.document_id JOIN sections s ON s.id = c.section_id
       WHERE c.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as ChunkRow[];
  return rows.map((r) => ({
    chunkId: r.id,
    documentId: r.document_id,
    documentName: r.display_name,
    sectionId: r.section_id,
    sectionIdx: r.idx,
    sectionLabel: r.label,
    sectionTitle: r.title,
    text: r.text,
    score: 1,
  }));
}

/** Format chunks as numbered, clearly fenced sources for a prompt. */
export function formatSources(chunks: RetrievedChunk[], maxCharsEach = 1400): { block: string; refs: SourceRef[] } {
  const refs: SourceRef[] = chunks.map((c, i) => ({
    n: i + 1,
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentName: c.documentName,
    sectionIdx: c.sectionIdx,
    sectionLabel: c.sectionLabel,
    sectionTitle: c.sectionTitle,
    excerpt: c.text.slice(0, 280),
  }));
  const block = chunks
    .map((c, i) => {
      const loc = `${c.sectionLabel}${c.sectionTitle ? ` — ${c.sectionTitle}` : ""}`;
      const body = sanitizeSourceText(c.text.slice(0, maxCharsEach));
      return `<source id="S${i + 1}" document="${sanitizeSourceText(c.documentName).replace(/"/g, "'")}" location="${loc.replace(/"/g, "'")}">\n${body}\n</source>`;
    })
    .join("\n\n");
  return { block, refs };
}

export function invalidateRetrievalCache(courseId?: string) {
  if (courseId) cache.delete(courseId);
  else cache.clear();
}
