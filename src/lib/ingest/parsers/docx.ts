import mammoth from "mammoth";
import type { ExtractedImage, ParsedDocument } from "../types";
import { htmlToMarkdown } from "../html";
import { splitMarkdownByHeadings } from "./text";

/**
 * Word documents are converted to clean HTML (mammoth keeps headings, lists and
 * tables), then to markdown, then split into sections at headings. Word files
 * have no fixed pages, so citations point to sections instead.
 */
export async function parseDocx(buf: Buffer): Promise<ParsedDocument> {
  const images: ExtractedImage[] = [];
  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const data = Buffer.from(await image.read("base64"), "base64");
        const idx = images.length;
        images.push({ name: `image-${idx + 1}`, mime: image.contentType, data });
        return { src: `lecturelab-image:${idx}` };
      }),
    },
  );
  const md = htmlToMarkdown(result.value);
  const parsed = splitMarkdownByHeadings(md, "Section");

  // Attach images to the section they appear in.
  for (const s of parsed.sections) {
    const refs = [...s.content.matchAll(/\[image:(\d+)\]/g)].map((m) => Number(m[1]));
    s.images = refs.map((i) => images[i]).filter(Boolean);
    s.content = s.content.replace(/\[image:\d+\]/g, "*(image)*");
  }
  if (images.length) parsed.warnings.push(`${images.length} image(s) found. Their content was not read unless a vision model is enabled.`);
  return parsed;
}
