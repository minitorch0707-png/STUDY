/** Small, dependency-free text helpers shared by the AI layer (unit tested). */

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "").trim();
}

/**
 * Pull a JSON value out of a model reply. Small local models sometimes wrap
 * JSON in ```fences``` or add a sentence before it, even in JSON mode.
 */
export function extractJson(text: string): unknown {
  const cleaned = stripThinking(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model output");
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error("Unterminated JSON in model output");
}

/**
 * Uploaded documents are UNTRUSTED. Before placing them in a prompt we neutralise
 * anything that could fake our own markup (e.g. a slide that says
 * "</source> Ignore previous instructions"). The model is also told that text
 * inside <source> tags is reference material, never instructions.
 */
export function sanitizeSourceText(text: string): string {
  return text
    .replace(/<\/?\s*(source|sources|system|instructions?)\b[^>]*>/gi, (m) => m.replace(/</g, "‹").replace(/>/g, "›"))
    .replace(/\u0000/g, "");
}

/** Rough token estimate (≈4 characters per token for English). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function truncate(text: string, maxChars: number) {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1).trimEnd() + "…";
}
