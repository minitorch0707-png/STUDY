import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, newId, nowIso, parseJson, UPLOAD_DIR } from "@/lib/db";
import { getEmbedder, getLLM, getStatus } from "@/lib/ai";
import { toBlob } from "@/lib/rag/vector";
import { invalidateRetrievalCache } from "@/lib/rag/retrieve";
import { chunkText } from "@/lib/ingest/chunk";
import { guessMetadata, parseDocument, validateUpload } from "@/lib/ingest/parse";
import type { ParsedSection, SupportedExt } from "@/lib/ingest/types";
import { detectDates, looksLikeSyllabus } from "@/lib/learning/syllabus";
import { getSettings } from "@/lib/settings";
import { runInBackground } from "./generations";
import { extractTopicsForDocument } from "./topics";
import { touchCourse } from "./courses";
import { logEvent } from "@/lib/logs";

export const PARSER_VERSION = 1;

export interface DocumentRow {
  id: string;
  course_id: string;
  stored_name: string;
  original_name: string;
  display_name: string;
  ext: SupportedExt;
  size: number;
  sha256: string;
  kind: string;
  week: number | null;
  lecture_label: string | null;
  status: string;
  status_detail: string | null;
  progress: number;
  section_count: number;
  warnings: string;
  created_at: string;
  updated_at: string;
}

export interface SectionRow {
  id: string;
  document_id: string;
  idx: number;
  label: string;
  title: string | null;
  content: string;
  notes: string | null;
  has_text: number;
  image_count: number;
  image_descriptions: string | null;
}

export const getDocument = (id: string) => (db().prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined) ?? null;

export function listDocuments(courseId: string) {
  const rows = db()
    .prepare("SELECT * FROM documents WHERE course_id = ? ORDER BY COALESCE(week, 999), kind != 'syllabus', created_at")
    .all(courseId) as DocumentRow[];
  return rows.map((r) => ({ ...r, warnings: parseJson<string[]>(r.warnings, []) }));
}

export function getSections(documentId: string) {
  return db().prepare("SELECT * FROM sections WHERE document_id = ? ORDER BY idx").all(documentId) as SectionRow[];
}

export function filePath(doc: Pick<DocumentRow, "course_id" | "stored_name">) {
  return path.join(UPLOAD_DIR, doc.course_id, doc.stored_name);
}

function setStatus(id: string, status: string, detail: string | null, progress: number) {
  db().prepare("UPDATE documents SET status = ?, status_detail = ?, progress = ?, updated_at = ? WHERE id = ?").run(status, detail, progress, nowIso(), id);
}

export type UploadResult = { ok: true; document: DocumentRow; duplicate?: boolean } | { ok: false; error: string; filename: string };

/** Save an uploaded file and start processing it in the background. */
export function addUpload(courseId: string, filename: string, buf: Buffer, replaceId?: string): UploadResult {
  const safeName = path.basename(filename).replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "file";
  const v = validateUpload(safeName, buf);
  if (!v.ok) {
    logEvent("warn", "upload", `Rejected ${safeName.replace(/^.*(\.[^.]+)$/, "file$1")} (${buf.length} bytes): ${v.error}`);
    return { ok: false, error: v.error, filename: safeName };
  }
  const sha = crypto.createHash("sha256").update(buf).digest("hex");

  // Same file already in this course → reuse the stored, processed copy.
  const dup = db().prepare("SELECT * FROM documents WHERE course_id = ? AND sha256 = ?").get(courseId, sha) as DocumentRow | undefined;
  if (dup && dup.id !== replaceId) return { ok: true, document: dup, duplicate: true };

  const dir = path.join(UPLOAD_DIR, courseId);
  fs.mkdirSync(dir, { recursive: true });
  const now = nowIso();

  if (replaceId) {
    const old = getDocument(replaceId);
    if (!old || old.course_id !== courseId) return { ok: false, error: "File to replace not found", filename: safeName };
    const stored = `${replaceId}-${Date.now()}.${v.ext}`;
    fs.writeFileSync(path.join(dir, stored), buf);
    fs.rmSync(filePath(old), { force: true });
    db().transaction(() => {
      db().prepare("DELETE FROM sections WHERE document_id = ?").run(replaceId); // cascades to chunks + topic links
      db().prepare("DELETE FROM topics WHERE document_id = ?").run(replaceId);
      db()
        .prepare("UPDATE documents SET stored_name=?, original_name=?, ext=?, size=?, sha256=?, status='queued', status_detail=NULL, progress=0, section_count=0, warnings='[]', updated_at=? WHERE id=?")
        .run(stored, safeName, v.ext, buf.length, sha, now, replaceId);
    })();
    invalidateRetrievalCache(courseId);
    runInBackground("ingest", () => processDocument(replaceId));
    return { ok: true, document: getDocument(replaceId)! };
  }

  const id = newId();
  const stored = `${id}.${v.ext}`;
  fs.writeFileSync(path.join(dir, stored), buf);
  const meta = guessMetadata(safeName);
  db()
    .prepare(
      `INSERT INTO documents (id, course_id, stored_name, original_name, display_name, ext, size, sha256, kind, week, lecture_label, status, parser_version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)`,
    )
    .run(id, courseId, stored, safeName, safeName.replace(/\.[^.]+$/, ""), v.ext, buf.length, sha, meta.kind, meta.week, meta.lecture, PARSER_VERSION, now, now);
  touchCourse(courseId);
  runInBackground("ingest", () => processDocument(id));
  return { ok: true, document: getDocument(id)! };
}

async function describeImages(sections: ParsedSection[], warnings: string[]) {
  const s = getSettings();
  if (!s.describeImages || !s.visionModel) return new Map<number, string>();
  const st = await getStatus();
  if (!st.reachable || !st.visionModel?.installed) {
    warnings.push(`Vision model "${s.visionModel}" isn't available, so images were not described.`);
    return new Map<number, string>();
  }
  const out = new Map<number, string>();
  const llm = getLLM();
  let described = 0;
  for (let i = 0; i < sections.length && described < 40; i++) {
    const imgs = sections[i].images.filter((im) => im.data.length > 8_000 && im.data.length < 6_000_000).slice(0, 2);
    if (!imgs.length) continue;
    try {
      const res = await llm.chat({
        model: s.visionModel,
        temperature: 0.1,
        maxTokens: 300,
        messages: [
          {
            role: "user",
            content: `This image is from a university lecture slide titled "${sections[i].title ?? sections[i].label}". Describe what it shows for a student: transcribe any text, explain diagrams/charts and their key takeaway. Be factual and concise (max 120 words). If it's decorative (logo, stock photo), reply only "decorative".`,
            images: imgs.map((im) => im.data.toString("base64")),
          },
        ],
      });
      const text = res.text.trim();
      if (text && !/^decorative\.?$/i.test(text)) out.set(i, text);
      described++;
    } catch (e) {
      warnings.push(`Couldn't describe images on ${sections[i].label}: ${(e as Error).message}`);
      break;
    }
  }
  return out;
}

/** The full pipeline: parse → store sections → chunk → embed → find topics → find dates. */
export async function processDocument(id: string) {
  const doc = getDocument(id);
  if (!doc) return;
  const warnings: string[] = [];
  try {
    setStatus(id, "parsing", "Reading the file…", 0.1);
    const buf = fs.readFileSync(filePath(doc));
    const s = getSettings();
    const parsed = await parseDocument(doc.ext, buf, { withImages: s.describeImages && Boolean(s.visionModel) });
    warnings.push(...parsed.warnings);
    if (!parsed.sections.some((s) => s.hasText)) {
      db().prepare("UPDATE documents SET warnings = ? WHERE id = ?").run(JSON.stringify(warnings), id);
      setStatus(id, "failed", "No readable text found in this file.", 1);
      return;
    }

    const visions = await describeImages(parsed.sections, warnings);

    const insertSection = db().prepare(
      "INSERT INTO sections (id, document_id, idx, label, title, content, notes, has_text, image_count, image_descriptions) VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    const insertChunk = db().prepare("INSERT INTO chunks (id, course_id, document_id, section_id, ord, text) VALUES (?,?,?,?,?,?)");
    const chunkIds: { id: string; text: string }[] = [];
    db().transaction(() => {
      db().prepare("DELETE FROM sections WHERE document_id = ?").run(id);
      parsed.sections.forEach((s, i) => {
        const sid = newId();
        const vision = visions.get(i) ?? null;
        insertSection.run(sid, id, i + 1, s.label, s.title, s.content, s.notes ?? null, s.hasText ? 1 : 0, s.images.length, vision);
        const full = [s.title ? `# ${s.title}` : "", s.content, s.notes ? `Lecturer notes: ${s.notes}` : "", vision ? `Image description: ${vision}` : ""]
          .filter(Boolean)
          .join("\n\n");
        chunkText(full).forEach((text, ord) => {
          const cid = newId();
          insertChunk.run(cid, doc.course_id, id, sid, ord, text);
          // Contextual header: helps embeddings know where the chunk came from.
          chunkIds.push({ id: cid, text: `${doc.display_name} — ${s.label}${s.title ? `: ${s.title}` : ""}\n${text}` });
        });
      });
      db().prepare("UPDATE documents SET section_count = ? WHERE id = ?").run(parsed.sections.length, id);
    })();

    // Embeddings (semantic search). Optional: keyword search works without them.
    setStatus(id, "embedding", "Indexing for search…", 0.4);
    const st = await getStatus();
    if (st.reachable && st.embeddingModel.installed) {
      const embedder = getEmbedder();
      const upd = db().prepare("UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?");
      for (let i = 0; i < chunkIds.length; i += 16) {
        const batch = chunkIds.slice(i, i + 16);
        const vecs = await embedder.embed(batch.map((b) => b.text), "document");
        db().transaction(() => batch.forEach((b, j) => upd.run(toBlob(vecs[j]), embedder.model, b.id)))();
        setStatus(id, "embedding", `Indexing for search… ${Math.min(i + 16, chunkIds.length)}/${chunkIds.length}`, 0.4 + 0.3 * ((i + 16) / chunkIds.length));
      }
    } else {
      warnings.push(
        st.reachable
          ? `Embedding model "${st.embeddingModel.name}" isn't installed, so only keyword search is available. Install it in Settings → AI Models, then re-index.`
          : "The local AI engine wasn't running, so only keyword search is available for now. Start Ollama, then use Re-analyse.",
      );
    }
    invalidateRetrievalCache(doc.course_id);

    // Syllabus dates (no AI needed).
    const fullText = parsed.sections.map((s) => `${s.title ?? ""}\n${s.content}`).join("\n");
    if (doc.kind === "syllabus" || looksLikeSyllabus(fullText)) {
      if (doc.kind !== "syllabus") db().prepare("UPDATE documents SET kind = 'syllabus' WHERE id = ?").run(id);
      importDetectedDates(doc.course_id, id, fullText);
    }

    // Topics
    setStatus(id, "analyzing", "Finding the main topics…", 0.75);
    const topicWarning = await extractTopicsForDocument(id);
    if (topicWarning) warnings.push(topicWarning);

    db().prepare("UPDATE documents SET warnings = ? WHERE id = ?").run(JSON.stringify(warnings), id);
    setStatus(id, "ready", null, 1);
    touchCourse(doc.course_id);
  } catch (e) {
    console.error("ingest failed", e);
    logEvent("error", "ingest", `${doc.ext} file (${doc.size} bytes) failed: ${(e as Error).message}\n${((e as Error).stack ?? "").split("\n").slice(1, 4).join("\n")}`);
    db().prepare("UPDATE documents SET warnings = ? WHERE id = ?").run(JSON.stringify(warnings), id);
    setStatus(id, "failed", `Processing failed: ${(e as Error).message}`.slice(0, 500), 1);
  }
}

export function importDetectedDates(courseId: string, documentId: string, text: string) {
  const found = detectDates(text);
  const exists = db().prepare("SELECT 1 FROM calendar_events WHERE course_id = ? AND date = ? AND lower(title) = lower(?)");
  const ins = db().prepare(
    "INSERT INTO calendar_events (id, course_id, title, kind, date, weight, source_document_id, source_text, confirmed, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)",
  );
  for (const f of found) {
    if (exists.get(courseId, f.date, f.title)) continue;
    ins.run(newId(), courseId, f.title, f.kind, f.date, f.weight, documentId, f.sourceText, nowIso());
  }
  return found.length;
}

/** Re-run embeddings + topic analysis using stored text (no re-parsing). */
export async function reanalyzeDocument(id: string) {
  const doc = getDocument(id);
  if (!doc) return;
  try {
    const st = await getStatus();
    const missing = db()
      .prepare(
        `SELECT c.id, c.text, s.label, s.title FROM chunks c JOIN sections s ON s.id = c.section_id
         WHERE c.document_id = ? AND (c.embedding IS NULL OR c.embedding_model != ?)`,
      )
      .all(id, getEmbedder().model) as { id: string; text: string; label: string; title: string | null }[];
    const warnings: string[] = parseJson<string[]>(doc.warnings, []).filter((w) => !/keyword search|AI engine|topics/i.test(w));
    if (missing.length && st.reachable && st.embeddingModel.installed) {
      setStatus(id, "embedding", "Indexing for search…", 0.3);
      const embedder = getEmbedder();
      const upd = db().prepare("UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?");
      for (let i = 0; i < missing.length; i += 16) {
        const batch = missing.slice(i, i + 16);
        const vecs = await embedder.embed(batch.map((b) => `${doc.display_name} — ${b.label}${b.title ? `: ${b.title}` : ""}\n${b.text}`), "document");
        db().transaction(() => batch.forEach((b, j) => upd.run(toBlob(vecs[j]), embedder.model, b.id)))();
      }
      invalidateRetrievalCache(doc.course_id);
    } else if (missing.length) {
      warnings.push("Semantic search is unavailable until the embedding model is running; keyword search is used.");
    }
    setStatus(id, "analyzing", "Finding the main topics…", 0.7);
    const tw = await extractTopicsForDocument(id, { replace: true });
    if (tw) warnings.push(tw);
    db().prepare("UPDATE documents SET warnings = ? WHERE id = ?").run(JSON.stringify(warnings), id);
    setStatus(id, "ready", null, 1);
  } catch (e) {
    setStatus(id, "failed", `Re-analysis failed: ${(e as Error).message}`.slice(0, 500), 1);
  }
}

export function updateDocument(id: string, patch: { display_name?: string; kind?: string; week?: number | null; lecture_label?: string | null }) {
  const doc = getDocument(id);
  if (!doc) return null;
  db()
    .prepare("UPDATE documents SET display_name = ?, kind = ?, week = ?, lecture_label = ?, updated_at = ? WHERE id = ?")
    .run(
      patch.display_name?.trim().slice(0, 200) || doc.display_name,
      patch.kind ?? doc.kind,
      patch.week === undefined ? doc.week : patch.week,
      patch.lecture_label === undefined ? doc.lecture_label : patch.lecture_label,
      nowIso(),
      id,
    );
  invalidateRetrievalCache(doc.course_id);
  return getDocument(id);
}

export function deleteDocument(id: string) {
  const doc = getDocument(id);
  if (!doc) return;
  db().prepare("DELETE FROM documents WHERE id = ?").run(id);
  fs.rmSync(filePath(doc), { force: true });
  invalidateRetrievalCache(doc.course_id);
}

/** After a restart, resume documents that were mid-processing. */
export function resumeInterruptedJobs() {
  const g = globalThis as unknown as { __resumed?: boolean };
  if (g.__resumed) return;
  g.__resumed = true;
  const stuck = db().prepare("SELECT id FROM documents WHERE status IN ('queued','parsing','embedding','analyzing')").all() as { id: string }[];
  for (const s of stuck) runInBackground("resume-ingest", () => processDocument(s.id));
  db().prepare("UPDATE quizzes SET status = 'failed', status_detail = 'Interrupted by a restart — please generate again.' WHERE status = 'generating'").run();
  db().prepare("UPDATE decks SET status = 'failed', status_detail = 'Interrupted by a restart — please generate again.' WHERE status = 'generating'").run();
}
