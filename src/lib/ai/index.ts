import "server-only";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { OllamaEmbeddings, OllamaProvider, ollamaFetch } from "./ollama";
import { OpenAICompatibleEmbeddings, OpenAICompatibleProvider } from "./openai-compatible";
import { extractJson } from "./text";
import { AIUnavailableError, type ChatRequest, type EmbeddingProvider, type LLMProvider, type ProviderStatus } from "./types";

export * from "./types";

/**
 * A laptop can only run one generation at a time efficiently, so all model calls
 * go through this small queue. Requests wait their turn instead of fighting over
 * memory (which would make every request slower).
 */
class Semaphore {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
  async *runStream<T>(gen: () => AsyncGenerator<T>): AsyncGenerator<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      yield* gen();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
  get queued() {
    return this.waiting.length;
  }
}

const g = globalThis as unknown as { __llmQueue?: Semaphore; __embedQueue?: Semaphore; __testLLM?: LLMProvider; __testEmbed?: EmbeddingProvider };
const llmQueue = (g.__llmQueue ??= new Semaphore(1));
const embedQueue = (g.__embedQueue ??= new Semaphore(1));

/** Tests can inject providers; the app itself never uses fake responses. */
export function setProvidersForTests(llm?: LLMProvider, embed?: EmbeddingProvider) {
  g.__testLLM = llm;
  g.__testEmbed = embed;
}

function rawLLM(): LLMProvider {
  if (g.__testLLM) return g.__testLLM;
  const s = getSettings();
  if (s.aiProvider === "openai-compatible") {
    return new OpenAICompatibleProvider({ baseUrl: s.openaiBaseUrl, apiKey: s.openaiApiKey, model: s.chatModel, temperature: s.temperature });
  }
  return new OllamaProvider({ baseUrl: s.ollamaUrl, model: s.chatModel, temperature: s.temperature, contextWindow: s.contextWindow });
}

export function getLLM(): LLMProvider {
  const inner = rawLLM();
  return {
    name: inner.name,
    model: inner.model,
    chat: (req) => llmQueue.run(() => inner.chat(req)),
    stream: (req) => llmQueue.runStream(() => inner.stream(req)),
  };
}

export function getEmbedder(): EmbeddingProvider {
  if (g.__testEmbed) return g.__testEmbed;
  const s = getSettings();
  const inner =
    s.aiProvider === "openai-compatible"
      ? new OpenAICompatibleEmbeddings({ baseUrl: s.openaiBaseUrl, apiKey: s.openaiApiKey }, s.embeddingModel)
      : new OllamaEmbeddings(s.ollamaUrl, s.embeddingModel);
  return { model: inner.model, embed: (t, k) => embedQueue.run(() => inner.embed(t, k)) };
}

/**
 * Ask the model for JSON matching a zod schema. We pass a JSON schema so the
 * engine constrains output, then validate, and retry once with the error if a
 * small model still gets it wrong.
 */
export async function generateJson<T>(
  schema: z.ZodType<T>,
  req: Omit<ChatRequest, "jsonSchema">,
  attempts = 2,
): Promise<T> {
  const llm = getLLM();
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  let messages = req.messages;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const res = await llm.chat({ ...req, messages, jsonSchema, think: false });
    try {
      return schema.parse(extractJson(res.text));
    } catch (e) {
      lastError = e;
      messages = [
        ...req.messages,
        { role: "assistant", content: res.text.slice(0, 4000) },
        { role: "user", content: `That was not valid. Problem: ${String((e as Error).message).slice(0, 500)}. Reply again with ONLY valid JSON matching the schema.` },
      ];
    }
  }
  throw new Error(`The AI model returned malformed data twice. ${(lastError as Error)?.message ?? ""}`.trim());
}

export async function getStatus(): Promise<ProviderStatus> {
  const s = getSettings();
  if (g.__testLLM) {
    return { provider: "test", reachable: true, chatModel: { name: g.__testLLM.model, installed: true }, embeddingModel: { name: "test", installed: true }, visionModel: null };
  }
  const base: ProviderStatus = {
    provider: s.aiProvider,
    reachable: false,
    chatModel: { name: s.chatModel, installed: false },
    embeddingModel: { name: s.embeddingModel, installed: false },
    visionModel: s.visionModel ? { name: s.visionModel, installed: false } : null,
  };
  try {
    if (s.aiProvider === "openai-compatible") {
      const res = await fetch(s.openaiBaseUrl.replace(/\/$/, "") + "/models", {
        headers: s.openaiApiKey ? { Authorization: `Bearer ${s.openaiApiKey}` } : {},
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);
      const has = (n: string) => ids.includes(n);
      return {
        ...base,
        reachable: true,
        chatModel: { name: s.chatModel, installed: has(s.chatModel) },
        embeddingModel: { name: s.embeddingModel, installed: has(s.embeddingModel) },
        visionModel: s.visionModel ? { name: s.visionModel, installed: has(s.visionModel) } : null,
      };
    }
    const [ver, tags] = await Promise.all([
      ollamaFetch(s.ollamaUrl, "/api/version", { timeoutMs: 4000 }).then((r) => r.json() as Promise<{ version: string }>),
      ollamaFetch(s.ollamaUrl, "/api/tags", { timeoutMs: 4000 }).then((r) => r.json() as Promise<{ models: { name: string }[] }>),
    ]);
    const names = tags.models.map((m) => m.name);
    const has = (n: string) => names.includes(n) || names.includes(`${n}:latest`);
    return {
      ...base,
      reachable: true,
      version: ver.version,
      chatModel: { name: s.chatModel, installed: has(s.chatModel) },
      embeddingModel: { name: s.embeddingModel, installed: has(s.embeddingModel) },
      visionModel: s.visionModel ? { name: s.visionModel, installed: has(s.visionModel) } : null,
    };
  } catch (e) {
    return { ...base, error: e instanceof AIUnavailableError ? e.message : `Can't reach the AI engine: ${(e as Error).message}` };
  }
}

/** Throws a friendly AIUnavailableError when the chat model can't be used. */
export async function requireChatModel() {
  const st = await getStatus();
  if (!st.reachable) throw new AIUnavailableError(st.error ?? "The local AI engine isn't running.");
  if (!st.chatModel.installed)
    throw new AIUnavailableError(`The model "${st.chatModel.name}" isn't installed yet. Open Settings → AI Models to install it.`);
  return st;
}

export function queueDepth() {
  return llmQueue.queued;
}
