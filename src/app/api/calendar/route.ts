import { z } from "zod";
import { body, handle } from "@/lib/api";
import { addEvent, listCalendar } from "@/lib/services/planner";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
export const GET = handle((req: Request) => {
  const p = new URL(req.url).searchParams;
  return Response.json(listCalendar({ courseId: p.get("course") ?? undefined, includeUnconfirmed: p.get("all") === "1" }));
});
export const POST = handle(async (req: Request) => {
  const b = await body(req, z.object({ courseId: z.string(), title: z.string().min(1).max(120), kind: z.enum(["exam", "assignment", "reading", "other"]), date, weight: z.number().min(0).max(100).nullable().optional() }));
  return Response.json({ id: addEvent(b) }, { status: 201 });
});
