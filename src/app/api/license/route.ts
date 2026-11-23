import { z } from "zod";
import { body, handle, rateLimit } from "@/lib/api";
import { activateLicense, licenseInfo, removeLicense, revalidateLicense } from "@/lib/license";

export const GET = handle(async () => {
  void revalidateLicense(); // occasional background re-check; never blocks
  return Response.json(licenseInfo());
});
export const POST = handle(async (req: Request) => {
  rateLimit("license", 10);
  const { key } = await body(req, z.object({ key: z.string().max(200) }));
  return Response.json(await activateLicense(key));
});
export const DELETE = handle(async () => Response.json(await removeLicense()));
