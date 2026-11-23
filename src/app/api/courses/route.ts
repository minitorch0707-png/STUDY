import { body, handle } from "@/lib/api";
import { courseInput, createCourse, listCourses } from "@/lib/services/courses";

export const GET = handle(() => Response.json(listCourses()));
export const POST = handle(async (req: Request) => Response.json(createCourse(await body(req, courseInput)), { status: 201 }));
