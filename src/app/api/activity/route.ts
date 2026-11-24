import { handle } from "@/lib/api";
import { activityReport, type ActivityRange } from "@/lib/services/activity";

/** Study activity: local AI usage totals (metadata only). */
export const GET = handle((req: Request) => {
  const r = new URL(req.url).searchParams.get("range");
  const range: ActivityRange = r === "today" || r === "30d" ? r : "7d";
  return Response.json(activityReport(range));
});
