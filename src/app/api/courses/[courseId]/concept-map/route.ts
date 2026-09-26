import { getCourse } from "@/lib/models";
import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { ConceptMapError, buildConceptMap } from "@/lib/conceptMap/build";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// Draws the course's concept map as a new canvas.
export async function POST(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null || !(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
  try {
    return Response.json(await buildConceptMap(courseId), { status: 201 });
  } catch (err) {
    if (err instanceof ConceptMapError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Drawing a concept map failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
