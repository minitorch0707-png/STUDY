import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseDocument, validateUpload, guessMetadata } from "@/lib/ingest/parse";
import { chunkText } from "@/lib/ingest/chunk";
import { htmlToMarkdown } from "@/lib/ingest/html";

const F = (n: string) => fs.readFileSync(path.join(__dirname, "../test-fixtures/files", n));

describe("document parsing", () => {
  it("parses PowerPoint slides in order with titles, bullets, tables and notes", async () => {
    const doc = await parseDocument("pptx", F("Week 3 - Lecture 3 - Mens Rea.pptx"));
    expect(doc.sections).toHaveLength(5);
    expect(doc.sections[0]).toMatchObject({ label: "Slide 1", title: "Week 3: Mens Rea" });
    const s3 = doc.sections[2];
    expect(s3.title).toBe("Subjective mens rea");
    expect(s3.content).toContain("- Recklessness: conscious awareness of a risk");
    expect(s3.notes).toContain("confuse recklessness with negligence");
    const s5 = doc.sections[4];
    expect(s5.content).toContain("| Question asked | What did the accused know? | What would a reasonable person know? |");
  });

  it("parses Word headings and tables into sections", async () => {
    const doc = await parseDocument("docx", F("LAW101 Syllabus.docx"));
    const all = doc.sections.map((s) => `${s.title}\n${s.content}`).join("\n");
    expect(doc.sections.some((s) => s.title === "Assessment")).toBe(true);
    expect(all).toContain("| Midterm Exam | 30% | October 20, 2026 |");
    expect(all).toContain("Week 3: Mens rea");
  });

  it("parses PDF pages, detects titles, and flags pages without text", async () => {
    const doc = await parseDocument("pdf", F("Reading - Actus Reus.pdf"));
    expect(doc.sections).toHaveLength(3);
    expect(doc.sections[0].title).toBe("Actus Reus: The Physical Element");
    expect(doc.sections[0].content).toContain("omission can satisfy the actus reus");
    expect(doc.sections[2].hasText).toBe(false);
    expect(doc.warnings.join(" ")).toMatch(/1 page\(s\) had no readable text/);
  });

  it("parses markdown text by headings", async () => {
    const doc = await parseDocument("md", Buffer.from("# Intro\nHello\n\n# Part two\nWorld"));
    expect(doc.sections.map((s) => s.title)).toEqual(["Intro", "Part two"]);
  });
});

describe("upload validation", () => {
  it("rejects disguised and unsupported files", () => {
    expect(validateUpload("x.exe", Buffer.from("MZ")).ok).toBe(false);
    expect(validateUpload("notes.pdf", Buffer.from("not a pdf")).ok).toBe(false);
    expect(validateUpload("slides.pptx", Buffer.from("hello")).ok).toBe(false);
    expect(validateUpload("a.txt", Buffer.from([0x00, 0x01, 0x02])).ok).toBe(false);
    expect(validateUpload("real.pdf", F("Reading - Actus Reus.pdf")).ok).toBe(true);
  });
  it("guesses kind and week from filenames", () => {
    expect(guessMetadata("Week 3 - Lecture 3 - Mens Rea.pptx")).toEqual({ kind: "lecture", week: 3, lecture: "Lecture 3" });
    expect(guessMetadata("LAW101 Syllabus.docx").kind).toBe("syllabus");
  });
});

describe("chunking", () => {
  it("keeps short sections whole and splits long ones with overlap", () => {
    expect(chunkText("short text")).toEqual(["short text"]);
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} explains an idea in some detail.`).join(" ");
    const chunks = chunkText(long, 400, 80);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
  });
  it("converts HTML tables and lists to markdown", () => {
    const md = htmlToMarkdown("<h2>T</h2><ul><li>a</li><li>b</li></ul><table><tr><td>x</td><td>y</td></tr></table>");
    expect(md).toContain("## T");
    expect(md).toContain("- a");
    expect(md).toContain("| x | y |");
  });
});
