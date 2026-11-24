import "server-only";
import { db } from "@/lib/db";

/**
 * App settings live in the local database. Secrets (like the YouTube key) never
 * leave the server: the browser only ever sees whether a key is set.
 */
export interface AppSettings {
  aiProvider: "ollama" | "openai-compatible";
  ollamaUrl: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  chatModel: string;
  embeddingModel: string;
  visionModel: string;        // empty = disabled
  temperature: number;
  contextWindow: number;      // tokens (Ollama num_ctx)
  thinking: boolean;
  replyLength: "quick" | "detailed"; // quick = short tutor answers, much faster on a laptop          // Qwen3 "thinking" mode for tutor answers (slower, sometimes better)
  youtubeApiKey: string;
  describeImages: boolean;    // run the vision model over slide images during upload
  setupComplete: boolean;     // first-run setup finished (or skipped)
  autoNotes: boolean;         // turn tutor conversations into notes automatically
  licenseKey: string;         // Pro licence key (secret)
  licenseInstanceId: string;  // activation id from the licence provider
  licenseStatus: "none" | "active" | "invalid";
  licenseCheckedAt: string;   // ISO time of the last successful online check
  licenseEmail: string;
}

/**
 * Default tutor model: the non-thinking 2507 update of Qwen3 4B. The original
 * qwen3:4b "thinks" before answering, which made first words take far longer.
 */
export const FAST_CHAT_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
/** The previous default. Installs still using it are offered the faster model. */
export const OLD_DEFAULT_CHAT_MODEL = "qwen3:4b";

export const DEFAULT_SETTINGS: AppSettings = {
  aiProvider: "ollama",
  ollamaUrl: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
  openaiBaseUrl: "http://127.0.0.1:1234/v1",
  openaiApiKey: "",
  chatModel: FAST_CHAT_MODEL,
  embeddingModel: "nomic-embed-text",
  visionModel: "",
  temperature: 0.4,
  contextWindow: 8192,
  thinking: false,
  replyLength: "quick",
  youtubeApiKey: "",
  describeImages: false,
  setupComplete: false,
  autoNotes: true,
  licenseKey: "",
  licenseInstanceId: "",
  licenseStatus: "none",
  licenseCheckedAt: "",
  licenseEmail: "",
};

const SECRET_KEYS: (keyof AppSettings)[] = ["openaiApiKey", "youtubeApiKey", "licenseKey", "licenseInstanceId"];

export function getSettings(): AppSettings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored: Partial<AppSettings> = {};
  for (const r of rows) {
    try {
      (stored as Record<string, unknown>)[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore malformed */
    }
  }
  const s = { ...DEFAULT_SETTINGS, ...stored };
  if (!s.youtubeApiKey && process.env.YOUTUBE_API_KEY) s.youtubeApiKey = process.env.YOUTUBE_API_KEY;
  // Use LectureLab's own (managed) AI engine when it's running and the student hasn't chosen another address.
  const managed = (globalThis as { __llManagedUrl?: string | null }).__llManagedUrl;
  if (managed && s.ollamaUrl === DEFAULT_SETTINGS.ollamaUrl) s.ollamaUrl = managed;
  return s;
}

export function updateSettings(patch: Partial<AppSettings>) {
  const stmt = db().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db().transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS) || v === undefined) continue;
      stmt.run(k, JSON.stringify(v));
    }
  });
  tx();
}

/** Safe-for-browser view: secrets replaced by "is it set?" flags. */
export function publicSettings() {
  const s = getSettings();
  const out: Record<string, unknown> = { ...s };
  for (const k of SECRET_KEYS) {
    out[k] = "";
    out[`${k}Set`] = Boolean(s[k]);
  }
  return out as Omit<AppSettings, "openaiApiKey" | "youtubeApiKey"> & {
    openaiApiKey: "";
    youtubeApiKey: "";
    openaiApiKeySet: boolean;
    youtubeApiKeySet: boolean;
  };
}
