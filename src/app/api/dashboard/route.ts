import { handle } from "@/lib/api";
import { dashboard } from "@/lib/services/progress";

export const GET = handle(() => Response.json(dashboard()));
