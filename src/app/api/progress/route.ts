import { handle } from "@/lib/api";
import { progressReport } from "@/lib/services/progress";

export const GET = handle((req: Request) => Response.json(progressReport(new URL(req.url).searchParams.get("course") ?? undefined)));
