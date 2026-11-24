import { AIUnavailableError, type ChatRequest, type ChatResult, type EmbeddingProvider, type LLMProvider } from "./types";
import { stripThinking } from "./text";

/** Ollama's HTTP API — https://github.com/ollama/ollama/blob/main/docs/api.md */

interface OllamaOpts {
  baseUrl: string;
  model: string;
  temperature: number;
  contextWindow: number;
}

const capabilityCache = new Map<string, { caps: string[]; at: number }>();

export async function ollamaFetch(baseUrl: string, path: string, init?: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs = 10 * 60_000, ...rest } = init ?? {};
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(baseUrl.replace(/\/$/, "") + path, {
      ...rest,
      signal,
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError" && rest.signal?.aborted) throw e;
    throw new AIUnavailableError(
      `Can't reach Ollama at ${baseUrl}. Is the Ollama app running? (${(e as Error).message})`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {}
    if (res.status === 404 && /model/i.test(msg)) {
      throw new AIUnavailableError(`Model not installed in Ollama: ${msg}. Install it from Settings → AI Models.`);
    }
    throw new Error(`Ollama error ${res.status}: ${msg}`);
  }
  return res;
}

export async function modelCapabilities(baseUrl: string, model: string): Promise<string[]> {
  const key = `${baseUrl}|${model}`;
  const hit = capabilityCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.caps;
  try {
    const res = await ollamaFetch(baseUrl, "/api/show", { method: "POST", body: JSON.stringify({ model }), timeoutMs: 10_000 });
    const json = (await res.json()) as { capabilities?: string[] };
    const caps = json.capabilities ?? [];
    capabilityCache.set(key, { caps, at: Date.now() });
    return caps;
  } catch {
    return [];
  }
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  constructor(private opts: OllamaOpts) {}
  get model() {
    return this.opts.model;
  }

  private async body(req: ChatRequest, stream: boolean) {
    const model = req.model ?? this.opts.model;
    const caps = await modelCapabilities(this.opts.baseUrl, model);
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      stream,
      keep_alive: "15m",
      options: {
        temperature: req.temperature ?? this.opts.temperature,
        num_ctx: this.opts.contextWindow,
        ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
      },
    };
    // Only send "think" to models that support it — others reject the field.
    if (caps.includes("thinking")) body.think = Boolean(req.think);
    if (req.jsonSchema) body.format = req.jsonSchema;
    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const res = await ollamaFetch(this.opts.baseUrl, "/api/chat", {
      method: "POST",
      body: JSON.stringify(await this.body(req, false)),
      signal: req.signal,
    });
    const json = (await res.json()) as {
      message?: { content?: string };
      model: string;
      prompt_eval_count?: number;
      eval_count?: number;
      eval_duration?: number;
    };
    req.onUsage?.({ inputTokens: json.prompt_eval_count, outputTokens: json.eval_count, outputDurationMs: json.eval_duration ? json.eval_duration / 1e6 : undefined });
    return {
      text: stripThinking(json.message?.content ?? ""),
      model: json.model,
      promptTokens: json.prompt_eval_count,
      outputTokens: json.eval_count,
      durationMs: Date.now() - started,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<string> {
    const res = await ollamaFetch(this.opts.baseUrl, "/api/chat", {
      method: "POST",
      body: JSON.stringify(await this.body(req, true)),
      signal: req.signal,
    });
    if (!res.body) throw new Error("Ollama returned an empty stream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inThink = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean; prompt_eval_count?: number; eval_count?: number; eval_duration?: number };
        if (msg.error) throw new Error(msg.error);
        if (msg.done) req.onUsage?.({ inputTokens: msg.prompt_eval_count, outputTokens: msg.eval_count, outputDurationMs: msg.eval_duration ? msg.eval_duration / 1e6 : undefined });
        let piece = msg.message?.content ?? "";
        // Some models print <think>…</think> inline; hide it from students.
        if (piece.includes("<think>")) inThink = true;
        if (inThink) {
          const end = piece.indexOf("</think>");
          if (end === -1) continue;
          inThink = false;
          piece = piece.slice(end + "</think>".length);
        }
        if (piece) yield piece;
      }
    }
  }
}

export class OllamaEmbeddings implements EmbeddingProvider {
  constructor(private baseUrl: string, readonly model: string) {}

  private prefix(kind: "query" | "document") {
    // nomic-embed-text was trained with task prefixes; using them improves retrieval.
    if (/nomic-embed/i.test(this.model)) return kind === "query" ? "search_query: " : "search_document: ";
    return "";
  }

  async embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await ollamaFetch(this.baseUrl, "/api/embed", {
      method: "POST",
      body: JSON.stringify({ model: this.model, input: texts.map((t) => this.prefix(kind) + t), keep_alive: "15m" }),
    });
    const json = (await res.json()) as { embeddings: number[][] };
    return json.embeddings;
  }
}
