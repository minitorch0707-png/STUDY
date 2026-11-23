/**
 * The provider interfaces. Every AI feature in LectureLab talks to these
 * interfaces, never to Ollama directly, so the engine can be swapped
 * (Ollama today; llama.cpp, LM Studio, vLLM or a hosted open-weight API later)
 * without touching feature code.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Base64-encoded images (vision models only). */
  images?: string[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** JSON schema the answer must follow (structured output). */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  /** Allow the model's slower "thinking" mode, if it has one. */
  think?: boolean;
  /** Override the configured chat model (e.g. use the vision model). */
  model?: string;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  /** Yields text pieces as they are generated. */
  stream(req: ChatRequest): AsyncGenerator<string, void, unknown>;
}

export interface EmbeddingProvider {
  readonly model: string;
  /** "query" vs "document" matters for models such as nomic-embed-text. */
  embed(texts: string[], kind: "query" | "document"): Promise<number[][]>;
}

export interface ProviderStatus {
  provider: string;
  reachable: boolean;
  version?: string;
  error?: string;
  chatModel: { name: string; installed: boolean };
  embeddingModel: { name: string; installed: boolean };
  visionModel: { name: string; installed: boolean } | null;
}

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIUnavailableError";
  }
}
