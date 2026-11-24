import { AIUnavailableError, type ChatRequest, type ChatResult, type EmbeddingProvider, type LLMProvider } from "./types";
import { stripThinking } from "./text";

/**
 * Works with any server that speaks the OpenAI-style HTTP API: LM Studio,
 * llama.cpp's llama-server, vLLM, or hosted open-weight model providers.
 * This is how LectureLab can move to hosted inference later without rewrites.
 */

interface Opts {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

async function call(opts: { baseUrl: string; apiKey: string }, path: string, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(opts.baseUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new AIUnavailableError(`Can't reach the AI server at ${opts.baseUrl} (${(e as Error).message})`);
  }
  if (!res.ok) throw new Error(`AI server error ${res.status}: ${await res.text().catch(() => "")}`);
  return res;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  constructor(private opts: Opts) {}
  get model() {
    return this.opts.model;
  }

  private body(req: ChatRequest, stream: boolean) {
    return {
      model: req.model ?? this.opts.model,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      temperature: req.temperature ?? this.opts.temperature,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      messages: req.messages.map((m) =>
        m.images?.length
          ? {
              role: m.role,
              content: [
                { type: "text", text: m.content },
                ...m.images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } })),
              ],
            }
          : { role: m.role, content: m.content },
      ),
      ...(req.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "result", schema: req.jsonSchema } } }
        : {}),
    };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const res = await call(this.opts, "/chat/completions", this.body(req, false), req.signal);
    const json = (await res.json()) as {
      model: string;
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    req.onUsage?.({ inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens });
    return {
      text: stripThinking(json.choices?.[0]?.message?.content ?? ""),
      model: json.model ?? this.opts.model,
      promptTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      durationMs: Date.now() - started,
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<string> {
    const res = await call(this.opts, "/chat/completions", this.body(req, true), req.signal);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.replace(/^data:\s*/, "").trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.usage) req.onUsage?.({ inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens });
          const piece = parsed.choices?.[0]?.delta?.content;
          if (piece) yield piece as string;
        } catch {
          /* partial line */
        }
      }
    }
  }
}

export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  constructor(private opts: { baseUrl: string; apiKey: string }, readonly model: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await call(this.opts, "/embeddings", { model: this.model, input: texts });
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
