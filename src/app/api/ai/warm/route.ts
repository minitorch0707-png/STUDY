import { handle } from "@/lib/api";
import { warmChatModel } from "@/lib/ai";

/** Load the tutor model into memory before the student asks (stays on this computer). */
export const POST = handle(() => Response.json({ warming: warmChatModel() }));
