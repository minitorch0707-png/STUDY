import { z } from "zod";
import { body, handle, notFound } from "@/lib/api";
import { deleteTopic, getTopic, topicMastery, topicSections, updateTopic } from "@/lib/services/topics";
import { getChat, getLesson } from "@/lib/services/tutor";
import { getCourse } from "@/lib/services/courses";
import { db } from "@/lib/db";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]">) => {
  const { id } = await ctx.params;
  const topic = getTopic(id) ?? notFound("Topic not found");
  const siblings = db().prepare("SELECT id, title FROM topics WHERE course_id = ? ORDER BY ord").all(topic.course_id);
  return Response.json({ topic, course: getCourse(topic.course_id), sections: topicSections(id), lesson: getLesson(id), chat: getChat(id), mastery: topicMastery(id), siblings });
});
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/topics/[id]">) => {
  const { id } = await ctx.params;
  return Response.json(updateTopic(id, await body(req, z.object({ title: z.string().max(120).optional(), importance: z.number().int().min(1).max(3).optional() }))) ?? notFound());
});
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/topics/[id]">) => {
  const { id } = await ctx.params;
  deleteTopic(id);
  return Response.json({ ok: true });
});
