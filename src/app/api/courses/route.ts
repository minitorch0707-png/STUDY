import { body, handle } from "@/lib/api";
import { courseInput, createCourse, listCourses } from "@/lib/services/courses";
import { isPro, LicenseError } from "@/lib/license";
import { PLAN, PRODUCT } from "@/lib/product";

export const GET = handle(() => Response.json(listCourses()));
export const POST = handle(async (req: Request) => {
  const input = await body(req, courseInput);
  if (!isPro() && listCourses().length >= PLAN.freeCourseLimit) {
    throw new LicenseError(`The free plan includes ${PLAN.freeCourseLimit} courses. ${PRODUCT.proName} unlocks unlimited courses.`);
  }
  return Response.json(createCourse(input), { status: 201 });
});
