import { getCourse } from "@/lib/models";
import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { tagCourseConcepts } from "@/lib/review/tagConcepts";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// Tags the next few sets' untagged cards/questions with concepts; the
// client calls again while `remainingItems` > 0.
export async function POST(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  try {
    if (!(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
    return Response.json(await tagCourseConcepts(courseId));
  } catch (err) {
    if (err instanceof AiDisabledError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Tagging concepts failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
