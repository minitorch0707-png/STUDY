import { body, handle, notFound } from "@/lib/api";
import { courseInput, deleteCourse, getCourse, updateCourse } from "@/lib/services/courses";
import { listDocuments } from "@/lib/services/documents";
import { listTopics } from "@/lib/services/topics";
import { listCalendar } from "@/lib/services/planner";
import { detectExamFormat } from "@/lib/learning/syllabus";
import { db } from "@/lib/db";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/courses/[id]">) => {
  const { id } = await ctx.params;
  const course = getCourse(id) ?? notFound("Course not found");
  const syllabusText = (db()
    .prepare("SELECT group_concat(s.content, ' ') t FROM sections s JOIN documents d ON d.id = s.document_id WHERE d.course_id = ? AND d.kind = 'syllabus'")
    .get(id) as { t: string | null }).t ?? "";
  return Response.json({
    course,
    documents: listDocuments(id),
    topics: listTopics(id),
    events: listCalendar({ courseId: id, includeUnconfirmed: true }),
    syllabusFormats: detectExamFormat(syllabusText),
  });
});
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/courses/[id]">) => {
  const { id } = await ctx.params;
  return Response.json(updateCourse(id, await body(req, courseInput.partial())) ?? notFound());
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/courses/[id]">) => {
  const { id } = await ctx.params;
  deleteCourse(id);
  return Response.json({ ok: true });
});
