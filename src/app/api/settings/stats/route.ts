import { handle } from "@/lib/api";
import { generationStats } from "@/lib/services/generations";

export const GET = handle(() => Response.json(generationStats()));
