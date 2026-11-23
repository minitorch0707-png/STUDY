import CFB from "cfb";
import { FriendlyError, type ParsedDocument, type ParsedSection } from "../types";

/**
 * Old PowerPoint files (.ppt, PowerPoint 97–2003) are binary "records" inside
 * an OLE container. Based on Microsoft's published [MS-PPT] specification:
 *
 *  - "Current User" stream → offset of the latest edit
 *  - UserEditAtom chain → persist directory (object id → byte offset)
 *  - DocumentContainer → SlideListWithText (slide order + placeholder text)
 *  - each SlideContainer / NotesContainer → text boxes and speaker notes
 *
 * If the structured route fails (unusual or damaged files) we fall back to
 * reading slides in file order, which still recovers the text.
 */

const RT = {
  Document: 0x03e8,
  Slide: 0x03ee,
  SlideAtom: 0x03ef,
  Notes: 0x03f0,
  SlidePersistAtom: 0x03f3,
  MainMaster: 0x03f8,
  SlideListWithText: 0x0ff0,
  TextHeaderAtom: 0x0f9f,
  TextCharsAtom: 0x0fa0,
  TextBytesAtom: 0x0fa8,
  UserEditAtom: 0x0ff5,
  PersistDirectoryAtom: 0x1772,
  CurrentUserAtom: 0x0ff6,
} as const;

// TextHeaderAtom text types
const TITLE_TYPES = new Set([0, 6]);
const BODY_TYPES = new Set([1, 5, 7, 8]);
const NOTES_TYPE = 2;

interface Rec {
  type: number;
  instance: number;
  container: boolean;
  start: number; // start of record data
  end: number;
}

function readRec(buf: Buffer, off: number): Rec | null {
  if (off + 8 > buf.length) return null;
  const verInst = buf.readUInt16LE(off);
  const type = buf.readUInt16LE(off + 2);
  const len = buf.readUInt32LE(off + 4);
  const start = off + 8;
  const end = Math.min(buf.length, start + len);
  return { type, instance: verInst >> 4, container: (verInst & 0x0f) === 0x0f, start, end };
}

function* children(buf: Buffer, parent: { start: number; end: number }): Generator<Rec> {
  let off = parent.start;
  let guard = 0;
  while (off + 8 <= parent.end && guard++ < 200_000) {
    const r = readRec(buf, off);
    if (!r || r.end <= off) return;
    yield r;
    off = r.end;
  }
}

/** All records under a container, depth-first, in file order. */
function* walk(buf: Buffer, parent: { start: number; end: number }, depth = 0): Generator<Rec> {
  if (depth > 40) return;
  for (const r of children(buf, parent)) {
    yield r;
    if (r.container) yield* walk(buf, r, depth + 1);
  }
}

function atomText(buf: Buffer, r: Rec): string {
  const raw = r.type === RT.TextCharsAtom ? buf.toString("utf16le", r.start, r.end) : buf.toString("latin1", r.start, r.end);
  return raw
    .replace(/\r|\u000b/g, "\n") // paragraph and line breaks
    .replace(/[\u0000-\u0008\u000c\u000e-\u001f]/g, "")
    .trim();
}

interface TextRun {
  type: number;
  text: string;
}

function textRuns(buf: Buffer, container: { start: number; end: number }): TextRun[] {
  const out: TextRun[] = [];
  let type = 4;
  for (const r of walk(buf, container)) {
    if (r.type === RT.TextHeaderAtom && r.end - r.start >= 4) type = buf.readUInt32LE(r.start);
    else if (r.type === RT.TextCharsAtom || r.type === RT.TextBytesAtom) {
      const text = atomText(buf, r);
      if (text && text !== "*") out.push({ type, text }); // "*" = slide-number field
    }
  }
  return out;
}

function persistDirectory(doc: Buffer, currentEdit: number): { offsets: Map<number, number>; docRef: number } {
  const offsets = new Map<number, number>();
  let docRef = 0;
  let editOff = currentEdit;
  const seen = new Set<number>();
  while (editOff > 0 && !seen.has(editOff) && seen.size < 1000) {
    seen.add(editOff);
    const edit = readRec(doc, editOff);
    if (!edit || edit.type !== RT.UserEditAtom) break;
    const lastEdit = doc.readUInt32LE(edit.start + 8);
    const dirOff = doc.readUInt32LE(edit.start + 12);
    if (!docRef) docRef = doc.readUInt32LE(edit.start + 16);
    const dir = readRec(doc, dirOff);
    if (dir && dir.type === RT.PersistDirectoryAtom) {
      let p = dir.start;
      while (p + 4 <= dir.end) {
        const head = doc.readUInt32LE(p);
        const first = head & 0xfffff;
        const count = head >>> 20;
        p += 4;
        for (let i = 0; i < count && p + 4 <= dir.end; i++, p += 4) {
          if (!offsets.has(first + i)) offsets.set(first + i, doc.readUInt32LE(p)); // newest edit wins
        }
      }
    }
    editOff = lastEdit;
  }
  return { offsets, docRef };
}

function toSection(i: number, runs: TextRun[], notes: string[]): ParsedSection {
  const titleRun = runs.find((r) => TITLE_TYPES.has(r.type));
  const title = titleRun ? titleRun.text.replace(/\n+/g, " ") : null;
  const lines: string[] = [];
  const seen = new Set<string>(title ? [title] : []);
  for (const r of runs) {
    if (r === titleRun || r.type === NOTES_TYPE) continue;
    if (seen.has(r.text)) continue;
    seen.add(r.text);
    const parts = r.text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (BODY_TYPES.has(r.type) && parts.length > 1) lines.push(...parts.map((l) => `- ${l}`));
    else lines.push(...parts);
  }
  const notesText = [...new Set([...notes, ...runs.filter((r) => r.type === NOTES_TYPE).map((r) => r.text)])].join("\n").trim() || null;
  const content = lines.join("\n").trim();
  return { label: `Slide ${i + 1}`, title, content, notes: notesText, hasText: Boolean(content || title || notesText), images: [] };
}

function structured(doc: Buffer, currentUser: Buffer): ParsedSection[] {
  const cu = readRec(currentUser, 0);
  if (!cu || cu.type !== RT.CurrentUserAtom) throw new Error("no current-user record");
  const token = currentUser.readUInt32LE(cu.start + 4);
  if (token === 0xf3d1c4df) throw new PptError("This PowerPoint file is password-protected. Remove the password in PowerPoint (File → Info → Protect Presentation), save, and upload again.");
  const { offsets, docRef } = persistDirectory(doc, currentUser.readUInt32LE(cu.start + 8));
  const docOff = offsets.get(docRef);
  const docRec = docOff !== undefined ? readRec(doc, docOff) : null;
  if (!docRec || docRec.type !== RT.Document) throw new Error("document container not found");

  type SlideRef = { persist: number; id: number; runs: TextRun[] };
  const slides: SlideRef[] = [];
  const notesById = new Map<number, number>(); // notesId → persist id
  for (const r of children(doc, docRec)) {
    if (r.type !== RT.SlideListWithText) continue;
    let cur: SlideRef | null = null;
    let type = 4;
    for (const c of children(doc, r)) {
      if (c.type === RT.SlidePersistAtom) {
        const persist = doc.readUInt32LE(c.start);
        const id = doc.readUInt32LE(c.start + 12);
        if (r.instance === 0) {
          cur = { persist, id, runs: [] };
          slides.push(cur);
        } else if (r.instance === 2) notesById.set(id, persist);
        else cur = null;
      } else if (r.instance === 0 && cur) {
        if (c.type === RT.TextHeaderAtom) type = doc.readUInt32LE(c.start);
        else if (c.type === RT.TextCharsAtom || c.type === RT.TextBytesAtom) {
          const text = atomText(doc, c);
          if (text && text !== "*") cur.runs.push({ type, text });
        }
      }
    }
  }
  if (!slides.length) throw new Error("no slides listed");

  return slides.map((s, i) => {
    const runs = [...s.runs];
    const notes: string[] = [];
    const off = offsets.get(s.persist);
    const rec = off !== undefined ? readRec(doc, off) : null;
    if (rec && rec.type === RT.Slide) {
      // Text boxes that aren't placeholders live inside the slide itself.
      for (const t of textRuns(doc, rec)) if (!runs.some((r) => r.text === t.text)) runs.push(t);
      const atom = [...children(doc, rec)].find((c) => c.type === RT.SlideAtom);
      const notesId = atom && atom.end - atom.start >= 20 ? doc.readUInt32LE(atom.start + 16) : 0;
      const notesPersist = notesId ? notesById.get(notesId) : undefined;
      const nOff = notesPersist !== undefined ? offsets.get(notesPersist) : undefined;
      const nRec = nOff !== undefined ? readRec(doc, nOff) : null;
      if (nRec && nRec.type === RT.Notes) {
        for (const t of textRuns(doc, nRec)) if (t.type === NOTES_TYPE || t.type === 4) notes.push(t.text);
      }
    }
    return toSection(i, runs, notes);
  });
}

/** Fallback: every slide container in file order. */
function sequential(doc: Buffer): ParsedSection[] {
  const sections: ParsedSection[] = [];
  for (const r of walk(doc, { start: 0, end: doc.length })) {
    if (r.type === RT.Slide) sections.push(toSection(sections.length, textRuns(doc, r), []));
  }
  return sections;
}

export class PptError extends FriendlyError {}

export function parsePpt(buf: Buffer): ParsedDocument {
  let file: CFB.CFB$Container;
  try {
    file = CFB.read(buf, { type: "buffer" });
  } catch {
    throw new PptError("This .ppt file couldn't be opened — it may be damaged. Try opening it in PowerPoint or Keynote and saving it again.");
  }
  const docEntry = CFB.find(file, "PowerPoint Document");
  const userEntry = CFB.find(file, "Current User");
  if (!docEntry?.content) throw new PptError("This doesn't look like a PowerPoint file.");
  if (CFB.find(file, "PP40") || CFB.find(file, "Header")) {
    throw new PptError("This is a very old PowerPoint file (PowerPoint 95 or earlier). Open it in PowerPoint or Keynote and save it as .pptx, then upload that.");
  }
  const doc = Buffer.from(docEntry.content as Uint8Array);
  const warnings: string[] = [];
  let sections: ParsedSection[];
  try {
    if (!userEntry?.content) throw new Error("no current user stream");
    sections = structured(doc, Buffer.from(userEntry.content as Uint8Array));
  } catch (e) {
    if (e instanceof PptError) throw e;
    sections = sequential(doc);
    if (sections.length) warnings.push("This older PowerPoint file has an unusual structure; slide order may not be exact.");
  }
  if (!sections.length) throw new PptError("No slides were found in this .ppt file. Try saving it as .pptx and uploading that.");
  const empty = sections.filter((s) => !s.hasText);
  if (empty.length) warnings.push(`${empty.length} slide(s) contain no text (${empty.slice(0, 6).map((s) => s.label).join(", ")}${empty.length > 6 ? "…" : ""}), probably images or diagrams.`);
  warnings.push("Old .ppt format: text and notes were read, but tables are flattened and images are not analysed. Saving as .pptx gives the best results.");
  return { sections, warnings };
}
