import "server-only";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { KEEP_ALIVE, OllamaEmbeddings, OllamaProvider, ollamaFetch } from "./ollama";
import { OpenAICompatibleEmbeddings, OpenAICompatibleProvider } from "./openai-compatible";
import { extractJson } from "./text";
import { AIUnavailableError, type ChatRequest, type EmbeddingProvider, type LLMProvider, type ProviderStatus, type RuntimeUsage } from "./types";
import { isLoopbackUrl, recordUsage } from "@/lib/services/activity";
import { newId } from "@/lib/db";

export * from "./types";

/**
 * A laptop can only run one generation at a time efficiently, so all model calls
 * go through this small queue. Requests wait their turn instead of fighting over
 * memory (which would make every request slower).
 */
/**
 * One AI job at a time (a laptop can't run two quickly). Jobs the student is
 * waiting on (tutor answers, lessons) go ahead of background work such as
 * note updates, flashcards or slide descriptions.
 */
class Semaphore {
  private active = 0;
  private waiting: { urgent: boolean; go: () => void }[] = [];
  constructor(private limit: number) {}
  private async acquire(urgent: boolean) {
    if (this.active >= this.limit)
      await new Promise<void>((go) => {
        const entry = { urgent, go };
        if (urgent) {
          const firstBackground = this.waiting.findIndex((w) => !w.urgent);
          if (firstBackground === -1) this.waiting.push(entry);
          else this.waiting.splice(firstBackground, 0, entry);
        } else this.waiting.push(entry);
      });
    this.active++;
  }
  private release() {
    this.active--;
    this.waiting.shift()?.go();
  }
  async run<T>(fn: () => Promise<T>, urgent = false): Promise<T> {
    await this.acquire(urgent);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  async *runStream<T>(gen: () => AsyncGenerator<T>, urgent = false): AsyncGenerator<T> {
    await this.acquire(urgent);
    try {
      yield* gen();
    } finally {
      this.release();
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

/** Where runs go, for the Study activity panel: "local" only when verifiably on this computer. */
function runtimeMeta(inner: LLMProvider): { provider: string; localOnly: boolean } {
  if (g.__testLLM) return { provider: inner.name, localOnly: true };
  const s = getSettings();
  return s.aiProvider === "openai-compatible" ? { provider: "openai-compatible", localOnly: isLoopbackUrl(s.openaiBaseUrl) } : { provider: "ollama", localOnly: isLoopbackUrl(s.ollamaUrl) };
}

/** Work the student is actively waiting for. */
const URGENT_TASKS = new Set(["tutor", "lesson", "checks", "grading"]);
const isUrgent = (req: ChatRequest) => URGENT_TASKS.has(req.usage?.task ?? "");

export function getLLM(): LLMProvider {
  const inner = rawLLM();
  const meta = runtimeMeta(inner);
  // Every run is measured here (counts and timings only; never content).
  const record = (req: ChatRequest, usage: RuntimeUsage, completed: boolean, started: number, firstText: number | null) =>
    recordUsage({
      runKey: newId(),
      task: req.usage?.task ?? "other",
      replyId: req.usage?.replyId ?? null,
      completed,
      provider: meta.provider,
      model: req.model ?? inner.model,
      localOnly: meta.localOnly,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      durationMs: Date.now() - started,
      firstTextMs: firstText,
      outputTokensPerS: usage.outputTokens && usage.outputDurationMs ? usage.outputTokens / (usage.outputDurationMs / 1000) : null,
    });
  return {
    name: inner.name,
    model: inner.model,
    chat: (req) =>
      llmQueue.run(async () => {
        let usage: RuntimeUsage = {};
        const started = Date.now();
        try {
          const res = await inner.chat({ ...req, onUsage: (u) => ((usage = u), req.onUsage?.(u)) });
          if (usage.inputTokens === undefined && usage.outputTokens === undefined && (res.promptTokens || res.outputTokens)) usage = { inputTokens: res.promptTokens, outputTokens: res.outputTokens };
          record(req, usage, true, started, null);
          return res;
        } catch (e) {
          record(req, usage, false, started, null);
          throw e;
        }
      }, isUrgent(req)),
    stream: (req) =>
      llmQueue.runStream(async function* () {
        let usage: RuntimeUsage = {};
        const started = Date.now();
        let firstText: number | null = null;
        let completed = false;
        try {
          for await (const piece of inner.stream({ ...req, onUsage: (u) => ((usage = u), req.onUsage?.(u)) })) {
            if (firstText === null && piece) firstText = Date.now() - started;
            yield piece;
          }
          completed = true;
        } finally {
          record(req, usage, completed, started, firstText);
        }
      }, isUrgent(req)),
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
  // "input" mode describes what the model should send (before our clean-up transforms run).
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
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

let lastWarm = 0;
/**
 * Load the chat model into memory ahead of the first question (e.g. when the
 * Tutor opens), so the first reply doesn't include several seconds of loading.
 * Never runs more than once every few minutes.
 */
export function warmChatModel() {
  if (g.__testLLM || Date.now() - lastWarm < 4 * 60_000) return false;
  const s = getSettings();
  if (s.aiProvider !== "ollama") return false;
  lastWarm = Date.now();
  ollamaFetch(s.ollamaUrl, "/api/generate", { method: "POST", body: JSON.stringify({ model: s.chatModel, keep_alive: KEEP_ALIVE }), timeoutMs: 120_000 }).catch(() => {
    lastWarm = 0;
  });
  return true;
}
