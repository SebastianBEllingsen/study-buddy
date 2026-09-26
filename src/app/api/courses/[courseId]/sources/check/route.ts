import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { getCourse } from "@/lib/models";
import { NotEnoughSourcesError, runConflictCheck } from "@/lib/sources/conflicts";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// Compares the course's documents and generation notes for contradictions.
export async function POST(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  const course = courseId === null ? undefined : await getCourse(courseId);
  if (!course) return Response.json({ error: "Course not found" }, { status: 404 });
  try {
    return Response.json({ check: await runConflictCheck(course.id) });
  } catch (err) {
    if (err instanceof NotEnoughSourcesError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Conflict check failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
