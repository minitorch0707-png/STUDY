import { handle, rateLimit } from "@/lib/api";
import { requireChatModel } from "@/lib/ai";
import { benchmark } from "@/lib/services/models";

export const POST = handle(async () => {
  rateLimit("benchmark", 4);
  await requireChatModel();
  return Response.json(await benchmark());
});
