import { handle } from "@/lib/api";
import { ensureEngine } from "@/lib/engine";

/** Start (downloading if needed) the AI engine in the background. Poll GET /api/setup for progress. */
export const POST = handle(async () => {
  void ensureEngine({ allowDownload: true });
  return Response.json({ started: true });
});
