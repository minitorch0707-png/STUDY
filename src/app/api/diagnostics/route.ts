import os from "node:os";
import { z } from "zod";
import { body, handle } from "@/lib/api";
import { getStatus } from "@/lib/ai";
import { engineStatus } from "@/lib/engine";
import { logEvent, recentLogs } from "@/lib/logs";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import pkg from "../../../../package.json";

/** Everything needed to help someone troubleshoot, minus personal content and keys. */
export const GET = handle(async () => {
  const s = getSettings();
  const counts = db().prepare("SELECT (SELECT COUNT(*) FROM courses) courses, (SELECT COUNT(*) FROM documents) documents, (SELECT COUNT(*) FROM documents WHERE status='failed') failed").get();
  const docs = db().prepare("SELECT ext, size, status, section_count, status_detail FROM documents ORDER BY created_at DESC LIMIT 15").all();
  return Response.json({
    app: { version: pkg.version, desktop: process.env.LECTURELAB_DESKTOP === "1" },
    system: { platform: process.platform, arch: process.arch, osRelease: os.release(), memoryGB: Math.round(os.totalmem() / 1024 ** 3), node: process.version },
    ai: { ...(await getStatus()), engine: await engineStatus(), chatModel: s.chatModel, embeddingModel: s.embeddingModel },
    counts,
    recentDocuments: docs,
    logs: recentLogs(40),
  });
});

/** Lets the browser record problems the server can't see (e.g. an upload that never arrived). */
export const POST = handle(async (req: Request) => {
  const { message } = await body(req, z.object({ message: z.string().max(1000) }));
  logEvent("warn", "browser", message);
  return Response.json({ ok: true });
});
