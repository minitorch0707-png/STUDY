import { handle, notFound } from "@/lib/api";
import { getDocument, reanalyzeDocument } from "@/lib/services/documents";
import { runInBackground } from "@/lib/services/generations";
import { db, nowIso } from "@/lib/db";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/documents/[id]/reanalyze">) => {
  const { id } = await ctx.params;
  if (!getDocument(id)) notFound();
  db().prepare("UPDATE documents SET status='analyzing', status_detail='Queued for re-analysis…', progress=0.2, updated_at=? WHERE id=?").run(nowIso(), id);
  runInBackground("reanalyze", () => reanalyzeDocument(id));
  return Response.json({ ok: true });
});
