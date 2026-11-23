import { handle } from "@/lib/api";
import { getStatus, queueDepth } from "@/lib/ai";

export const GET = handle(async () => Response.json({ ...(await getStatus()), queue: queueDepth() }));
