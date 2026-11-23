import { handle, HttpError } from "@/lib/api";
import { deleteModel, modelOverview } from "@/lib/services/models";

export const GET = handle(async () => Response.json(await modelOverview()));
export const DELETE = handle(async (req: Request) => {
  const name = new URL(req.url).searchParams.get("name");
  if (!name) throw new HttpError(400, "Missing model name");
  await deleteModel(name);
  return Response.json({ ok: true });
});
