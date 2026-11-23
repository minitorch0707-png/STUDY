import "server-only";
import { getLLM, getStatus } from "@/lib/ai";
import { ollamaFetch } from "@/lib/ai/ollama";
import { getSettings } from "@/lib/settings";

/** Curated models that fit comfortably on a 16 GB Apple Silicon laptop. */
export const RECOMMENDED_MODELS = [
  { name: "qwen3:4b", role: "chat", size: "2.5 GB", ram: "~4–5 GB while running", note: "Recommended default. Strong reasoning for its size; good at structured quiz/flashcard output." },
  { name: "qwen3:4b-instruct-2507-q4_K_M", role: "chat", size: "2.5 GB", ram: "~4–5 GB", note: "Non-thinking 2507 update of Qwen3 4B — often faster replies. Try it if qwen3:4b feels slow." },
  { name: "gemma3:4b", role: "vision", size: "3.3 GB", ram: "~5–6 GB", note: "Understands images. Use as the vision model to describe diagrams on slides." },
  { name: "qwen3:8b", role: "chat", size: "5.2 GB", ram: "~7–8 GB", note: "Noticeably better answers, roughly half the speed. Fine on 16 GB if few other apps are open." },
  { name: "nomic-embed-text", role: "embedding", size: "274 MB", ram: "~0.5 GB", note: "Recommended embedding model for search over your materials." },
  { name: "embeddinggemma", role: "embedding", size: "622 MB", ram: "~1 GB", note: "Alternative multilingual embedding model." },
] as const;

export interface InstalledModel {
  name: string;
  size: number;
  modified_at: string;
  details?: { parameter_size?: string; quantization_level?: string; family?: string };
}

export async function modelOverview() {
  const s = getSettings();
  const status = await getStatus();
  let installed: InstalledModel[] = [];
  let running: { name: string; size: number; size_vram: number; expires_at: string; context_length?: number }[] = [];
  if (status.reachable && s.aiProvider === "ollama") {
    try {
      installed = ((await (await ollamaFetch(s.ollamaUrl, "/api/tags", { timeoutMs: 5000 })).json()) as { models: InstalledModel[] }).models;
      running = ((await (await ollamaFetch(s.ollamaUrl, "/api/ps", { timeoutMs: 5000 })).json()) as { models: typeof running }).models ?? [];
    } catch {
      /* shown as unreachable */
    }
  }
  return { status, installed, running, recommended: RECOMMENDED_MODELS };
}

/** Download a model through Ollama, streaming progress lines to the browser. */
export async function pullModel(name: string): Promise<Response> {
  const s = getSettings();
  if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(name)) return Response.json({ error: "Invalid model name" }, { status: 400 });
  const upstream = await ollamaFetch(s.ollamaUrl, "/api/pull", { method: "POST", body: JSON.stringify({ model: name, stream: true }), timeoutMs: 6 * 3600_000 });
  return new Response(upstream.body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

export async function deleteModel(name: string) {
  const s = getSettings();
  await ollamaFetch(s.ollamaUrl, "/api/delete", { method: "DELETE", body: JSON.stringify({ model: name }) });
}

/** A small, repeatable benchmark: speed + whether the model follows the JSON format. */
export async function benchmark() {
  const llm = getLLM();
  const prompt = `<source id="S1">Mens rea is the mental element of a crime. Recklessness means the accused was aware of a risk and took it anyway. Negligence is measured against a reasonable person.</source>
Using only the source, explain in 2 sentences the difference between recklessness and negligence, citing [S1].`;
  const started = Date.now();
  const res = await llm.chat({ messages: [{ role: "user", content: prompt }], temperature: 0, maxTokens: 200 });
  const ms = Date.now() - started;
  return {
    model: res.model,
    seconds: ms / 1000,
    outputTokens: res.outputTokens ?? null,
    tokensPerSecond: res.outputTokens ? Math.round((res.outputTokens / (ms / 1000)) * 10) / 10 : null,
    cited: /\[S1\]/.test(res.text),
    sample: res.text.slice(0, 600),
  };
}
