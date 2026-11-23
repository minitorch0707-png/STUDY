import { z } from "zod";
import { body, handle } from "@/lib/api";
import { pullModel } from "@/lib/services/models";

export const POST = handle(async (req: Request) => {
  const { name } = await body(req, z.object({ name: z.string() }));
  return pullModel(name);
});
