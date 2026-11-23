import { z } from "zod";
import { body, handle } from "@/lib/api";
import { updateSettings } from "@/lib/settings";

export const POST = handle(async (req: Request) => {
  const b = await body(req, z.object({ chatModel: z.string().max(100).optional(), embeddingModel: z.string().max(100).optional() }));
  updateSettings({ setupComplete: true, ...(b.chatModel ? { chatModel: b.chatModel } : {}), ...(b.embeddingModel ? { embeddingModel: b.embeddingModel } : {}) });
  return Response.json({ ok: true });
});
