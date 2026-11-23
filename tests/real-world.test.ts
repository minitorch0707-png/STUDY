import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseDocument, validateUpload } from "@/lib/ingest/parse";
import { numericString } from "@/lib/services/quiz";

const DIR = path.join(import.meta.dirname, "../test-fixtures/files/real-world");
const read = (f: string) => fs.readFileSync(path.join(DIR, f));

describe("real PowerPoint files (made in PowerPoint)", () => {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".pptx"))) {
    it(`parses ${f}`, async () => {
      const v = validateUpload(f, read(f));
      expect(v.ok).toBe(true);
      const doc = await parseDocument("pptx", read(f));
      expect(doc.sections.length).toBeGreaterThan(0);
      expect(doc.sections.some((s) => s.hasText)).toBe(true);
    });
  }

  it("keeps slide order, titles, nested bullets and speaker notes in a 48-slide talk", async () => {
    const doc = await parseDocument("pptx", read("2411-Performance_Up.pptx"));
    expect(doc.sections).toHaveLength(48);
    expect(doc.sections[0].title).toBe("Apache Performance Tuning");
    expect(doc.sections[0].notes).toContain("welcome");
    const s7 = doc.sections[6];
    expect(s7.title).toBe("No Silver Bullet");
    expect(s7.content).toContain("  - Dynamic Content"); // second-level bullet
  });

  it("reads tables with merged cells", async () => {
    const doc = await parseDocument("pptx", read("shapes.pptx"));
    expect(doc.sections[3].content).toContain("| A3 | B3 and C3 are merged |");
  });

  it("doesn't load image bytes unless asked (saves memory on big decks)", async () => {
    const lazy = await parseDocument("pptx", read("2411-Performance_Up.pptx"));
    const eager = await parseDocument("pptx", read("2411-Performance_Up.pptx"), { withImages: true });
    const bytes = (d: typeof lazy) => d.sections.flatMap((s) => s.images).reduce((n, i) => n + i.data.length, 0);
    expect(lazy.sections.flatMap((s) => s.images).length).toBe(eager.sections.flatMap((s) => s.images).length);
    expect(bytes(lazy)).toBe(0);
    expect(bytes(eager)).toBeGreaterThan(0);
  });
});

describe("uploads students actually have", () => {
  it("accepts large decks (photo-heavy lectures are often 50–200 MB)", () => {
    const big = Buffer.alloc(120 * 1024 * 1024);
    big[0] = 0x50;
    big[1] = 0x4b;
    expect(validateUpload("lecture.pptx", big).ok).toBe(true);
  });
  it("rejects damaged files and explains how to convert Keynote files", () => {
    const r = validateUpload("Week 1.ppt", Buffer.from("x"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/doesn't look like a real PowerPoint/);
    const k = validateUpload("Week 1.key", Buffer.from("x"));
    expect(!k.ok && k.error).toMatch(/Export To/);
  });
});

describe("tolerant of small-model output", () => {
  it("accepts numbers sent as strings without inventing missing answers", () => {
    const s = z.preprocess(numericString, z.number().int().nullable().optional());
    expect(s.parse("2")).toBe(2);
    expect(s.parse(null)).toBeNull();
    expect(s.parse(undefined)).toBeUndefined();
  });
});
