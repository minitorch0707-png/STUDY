/**
 * Split a section into retrieval chunks of roughly `target` characters on
 * paragraph/sentence boundaries, with a little overlap so ideas that straddle a
 * boundary are still found. A slide usually becomes exactly one chunk, which
 * keeps citations precise ("Slide 7").
 */
export function chunkText(text: string, target = 1100, overlap = 150): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= target * 1.3) return [clean];

  const units: string[] = [];
  for (const para of clean.split(/\n\s*\n|\n(?=[-*\d]+[.)]?\s)/)) {
    if (para.length <= target) units.push(para.trim());
    else units.push(...(para.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [para]).map((s) => s.trim()));
  }

  const chunks: string[] = [];
  let cur = "";
  for (const u of units.filter(Boolean)) {
    if (cur && cur.length + u.length + 1 > target) {
      chunks.push(cur.trim());
      const tail = cur.slice(-overlap);
      const cut = tail.search(/[.!?\n]\s/);
      cur = (cut >= 0 ? tail.slice(cut + 2) : "") + (cur ? "\n" : "");
    }
    if (u.length > target * 1.5) {
      // Very long sentence/table row: hard split.
      for (let i = 0; i < u.length; i += target) chunks.push(u.slice(i, i + target));
      cur = "";
      continue;
    }
    cur += (cur.trim() ? "\n" : "") + u;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
