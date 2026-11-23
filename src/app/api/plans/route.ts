import { z } from "zod";
import { body, handle } from "@/lib/api";
import { createPlan, listPlans } from "@/lib/services/planner";

export const GET = handle(() => Response.json(listPlans()));
export const POST = handle(async (req: Request) => {
  const b = await body(
    req,
    z.object({
      courseId: z.string(),
      examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an exam date"),
      dailyMinutes: z.number().int().min(15).max(600),
      examEventId: z.string().nullable().optional(),
      topicIds: z.array(z.string()).optional(),
      cram: z.boolean().optional(),
    }),
  );
  return Response.json({ id: createPlan(b) }, { status: 201 });
});
