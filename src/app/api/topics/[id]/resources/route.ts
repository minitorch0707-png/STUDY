import { handle, rateLimit } from "@/lib/api";
import { findResources } from "@/lib/services/resources";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]/resources">) => {
  const { id } = await ctx.params;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh) rateLimit("resources", 6);
  return Response.json(await findResources(id, refresh));
});
