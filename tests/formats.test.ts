import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { parseDocument, validateUpload } from "@/lib/ingest/parse";
import { rtfToText } from "@/lib/ingest/parsers/more";

const RW = path.join(import.meta.dirname, "../test-fixtures/files/real-world");
const read = (f: string) => fs.readFileSync(path.join(RW, f));

async function check(name: string, buf: Buffer) {
  const v = validateUpload(name, buf);
  if (!v.ok) throw new Error(v.error);
  return { ext: v.ext, doc: await parseDocument(v.ext, buf) };
}

describe("old PowerPoint (.ppt)", () => {
  it("reads slides in order with titles, bullets and speaker notes", async () => {
    const { ext, doc } = await check("Lecture 1.ppt", read("basic_test_ppt_file.ppt"));
    expect(ext).toBe("ppt");
    expect(doc.sections.map((s) => s.title)).toEqual(["This is a test title", "This is the title on page 2"]);
    expect(doc.sections[1].content).toBe("- This is page two\n- It has several blocks of text\n- None of them have formatting");
    expect(doc.sections[0].notes).toBe("These are the notes for page 1");
  });
  it("reads text boxes, accents and many slides", async () => {
    const bullets = await check("b.ppt", read("bullets.ppt"));
    expect(bullets.doc.sections[1].content).toContain("I’m a text box");
    const fr = await check("fr.ppt", read("41246-2.ppt"));
    expect(fr.doc.sections).toHaveLength(16);
    expect(fr.doc.sections[1].title).toBe("Évolution des politiques et programmes");
  });
  it("handles old/new formats with the wrong file extension", () => {
    expect(validateUpload("renamed.pptx", read("SampleShow.ppt"))).toEqual({ ok: true, ext: "ppt" });
    expect(validateUpload("renamed.ppt", read("shapes.pptx"))).toEqual({ ok: true, ext: "pptx" });
    expect(validateUpload("show.ppsx", read("shapes.pptx"))).toEqual({ ok: true, ext: "pptx" });
    expect(validateUpload("show.pps", read("SampleShow.ppt"))).toEqual({ ok: true, ext: "ppt" });
  });
});

describe("old Word (.doc)", () => {
  it("reads text and turns tab-separated rows into a table", async () => {
    const { doc } = await check("Reading.doc", read("simple-table.doc"));
    const all = doc.sections.map((s) => s.content).join("\n");
    expect(all).toContain("| Cell 1,1 | Cell 1,2 | Cell 1,3 |");
    expect(all).toContain("This text is below the table.");
    const sample = await check("Notes.doc", read("SampleDoc.doc"));
    expect(sample.doc.sections.map((s) => `${s.title}\n${s.content}`).join("\n")).toContain("This is page two");
  });
});

describe("other formats", () => {
  it("RTF", async () => {
    const B = String.fromCharCode(92); // a single backslash, kept out of the source to avoid escaping confusion
    const rtf = `{${B}rtf1${B}ansi{${B}fonttbl{${B}f0 Arial;}}{${B}*${B}generator Word;}${B}f0 Mens rea${B}par The ${B}b guilty${B}b0  mind ${B}'96 caf${B}'e9${B}par${B}u8220?Quote${B}u8221?}`;
    expect(rtfToText(rtf)).toBe("Mens rea\nThe guilty mind – café\n“Quote”");
    const { doc } = await check("notes.rtf", Buffer.from(rtf, "latin1"));
    expect(doc.sections[0].content + (doc.sections[0].title ?? "")).toContain("guilty mind");
  });

  it("OpenDocument presentation and text", async () => {
    const z = new JSZip();
    z.file("mimetype", "application/vnd.oasis.opendocument.presentation");
    z.file(
      "content.xml",
      `<office:document-content><office:body><office:presentation>
       <draw:page draw:name="p1"><draw:frame presentation:class="title"><draw:text-box><text:p>Causation</text:p></draw:text-box></draw:frame>
       <draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>But-for test</text:p></text:list-item><text:list-item><text:p>Legal cause</text:p></text:list-item></text:list></draw:text-box></draw:frame>
       <presentation:notes><draw:frame><draw:text-box><text:p>Stress the but-for test</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>
       </office:presentation></office:body></office:document-content>`,
    );
    const { doc } = await check("w.odp", await z.generateAsync({ type: "nodebuffer" }));
    expect(doc.sections[0]).toMatchObject({ label: "Slide 1", title: "Causation", content: "- But-for test\n- Legal cause", notes: "Stress the but-for test" });

    const t = new JSZip();
    t.file("content.xml", `<office:text><text:h text:outline-level="1">Intro</text:h><text:p>Hello &amp; welcome</text:p></office:text>`);
    const odt = await check("w.odt", await t.generateAsync({ type: "nodebuffer" }));
    expect(odt.doc.sections[0]).toMatchObject({ title: "Intro", content: "Hello & welcome" });
  });

  it("web pages, without scripts or navigation", async () => {
    const html = `<html><head><title>Torts</title><script>alert(1)</script></head><body><nav>Menu</nav><h2>Duty of care</h2><div>Owed to <b>neighbours</b>.</div></body></html>`;
    const { doc } = await check("page.html", Buffer.from(html));
    const all = JSON.stringify(doc.sections);
    expect(all).toContain("Duty of care");
    expect(all).toContain("**neighbours**");
    expect(all).not.toContain("alert");
    expect(all).not.toContain("Menu");
  });

  it("EPUB e-books in reading order", async () => {
    const z = new JSZip();
    z.file("META-INF/container.xml", `<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`);
    z.file("OEBPS/book.opf", `<package><manifest><item id="c2" href="ch2.xhtml"/><item id="c1" href="ch1.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
    z.file("OEBPS/ch1.xhtml", `<html><body><h1>Chapter One</h1><p>Contracts need offer and acceptance to be formed.</p></body></html>`);
    z.file("OEBPS/ch2.xhtml", `<html><body><h1>Chapter Two</h1><p>Consideration is something of value exchanged.</p></body></html>`);
    const { doc } = await check("book.epub", await z.generateAsync({ type: "nodebuffer" }));
    expect(doc.sections.map((s) => s.title)).toEqual(["Chapter One", "Chapter Two"]);
  });

  it("CSV as tables", async () => {
    const { doc } = await check("cases.csv", Buffer.from('Case,Year,Principle\n"Donoghue v Stevenson",1932,"Neighbour, principle"\n'));
    expect(doc.sections[0].content).toContain("| Donoghue v Stevenson | 1932 | Neighbour, principle |");
  });

  it("accepts photos for the image reader", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
    const { ext, doc } = await check("whiteboard.PNG", png);
    expect(ext).toBe("image");
    expect(doc.sections[0].images).toHaveLength(1);
  });

  it("explains files it can't read", () => {
    for (const [name, hint] of [["Week 1.key", /Export To/], ["Lecture.gslides", /Google Slides shortcut/], ["IMG_1234.HEIC", /JPEG/], ["grades.xlsx", /CSV/], ["lecture.mp4", /video/], ["x.exe", /isn't a file type/]] as const) {
      const r = validateUpload(name, Buffer.from("x"));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(hint);
    }
    expect(validateUpload("fake.doc", Buffer.from("hello")).ok).toBe(false);
  });
});
