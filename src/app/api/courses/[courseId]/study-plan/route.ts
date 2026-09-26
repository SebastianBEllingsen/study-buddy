import { getCourse } from "@/lib/models";
import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { InvalidAiResponseError } from "@/lib/aiResponseValidation";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { getStudyPlanForCourse } from "@/lib/studyPlan/store";
import { createStudyPlanForCourse, NoCurriculumError, SyllabusNotFoundError } from "@/lib/studyPlan/generatePlan";
import { parseStudyPlanOptions } from "@/lib/studyPlan/options";
import { parseSyllabusSource } from "@/lib/studyPlan/requestParsing";

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null || !(await getCourse(id))) return Response.json({ error: "Course not found" }, { status: 404 });
  return Response.json({ plan: (await getStudyPlanForCourse(id)) ?? null });
}

// Builds the course's study plan, replacing any existing one — the client
// confirms that with the user first. Body: { syllabus?: {documentId} |
// {text}, folderId?, documentIds?, options? }.
export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null || !(await getCourse(id))) return Response.json({ error: "Course not found" }, { status: 404 });

  const body = await parseJsonObjectBody(request);
  const syllabus = parseSyllabusSource(body.syllabus);
  if (!syllabus.ok) return Response.json({ error: syllabus.error }, { status: 400 });
  const folderId = Number.isInteger(body.folderId) ? (body.folderId as number) : null;
  const documentIds = Array.isArray(body.documentIds)
    ? body.documentIds.filter((d: unknown): d is number => Number.isInteger(d))
    : null;

  try {
    const plan = await createStudyPlanForCourse(id, {
      syllabus: syllabus.value,
      folderId,
      documentIds,
      options: parseStudyPlanOptions(body.options),
    });
    return Response.json({ plan }, { status: 201 });
  } catch (err) {
    if (
      err instanceof NoCurriculumError ||
      err instanceof SyllabusNotFoundError ||
      err instanceof AiDisabledError ||
      err instanceof InvalidAiResponseError
    ) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Study plan generation failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
