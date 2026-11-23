import { handle } from "@/lib/api";
import { getStatus } from "@/lib/ai";
import { engineStatus, recommendedModels } from "@/lib/engine";
import { getSettings } from "@/lib/settings";
import { ollamaFetch } from "@/lib/ai/ollama";

export const GET = handle(async () => {
  const [engine, ai] = await Promise.all([engineStatus(), getStatus()]);
  const s = getSettings();
  let installed: string[] = [];
  if (ai.reachable && s.aiProvider === "ollama") {
    try {
      installed = ((await (await ollamaFetch(s.ollamaUrl, "/api/tags", { timeoutMs: 4000 })).json()) as { models: { name: string }[] }).models.map((m) => m.name);
    } catch {}
  }
  const rec = recommendedModels();
  const has = (n: string) => installed.includes(n) || installed.includes(`${n}:latest`);
  return Response.json({
    engine,
    ai,
    recommended: rec,
    models: { chat: has(rec.chat.name) || has(s.chatModel), embedding: has(rec.embedding.name) || has(s.embeddingModel) },
    setupComplete: s.setupComplete,
    desktop: process.env.LECTURELAB_DESKTOP === "1",
    platform: process.platform,
  });
});
