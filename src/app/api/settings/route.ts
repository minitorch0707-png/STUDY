import { z } from "zod";
import { body, handle } from "@/lib/api";
import { publicSettings, updateSettings } from "@/lib/settings";

const schema = z.object({
  aiProvider: z.enum(["ollama", "openai-compatible"]).optional(),
  ollamaUrl: z.string().url().optional(),
  openaiBaseUrl: z.string().url().optional(),
  openaiApiKey: z.string().max(500).optional(),
  chatModel: z.string().min(1).max(100).optional(),
  embeddingModel: z.string().min(1).max(100).optional(),
  visionModel: z.string().max(100).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  contextWindow: z.number().int().min(2048).max(131072).optional(),
  thinking: z.boolean().optional(),
  youtubeApiKey: z.string().max(200).optional(),
  describeImages: z.boolean().optional(),
  autoNotes: z.boolean().optional(),
});

export const GET = handle(() => Response.json(publicSettings()));
export const PATCH = handle(async (req: Request) => {
  const patch = await body(req, schema);
  // Empty secret fields mean "unchanged" unless explicitly cleared with a single space.
  for (const k of ["openaiApiKey", "youtubeApiKey"] as const) {
    if (patch[k] === "") delete patch[k];
    else if (patch[k] === " ") patch[k] = "";
  }
  updateSettings(patch);
  return Response.json(publicSettings());
});
