import { getCourse } from "@/lib/models";
import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { NoPastExamsError, analyzePastExams } from "@/lib/exams/analyze";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

// Analyses the picked documents as past exams. Body: { documentIds: number[] }.
export async function POST(request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const ids = (await parseJsonObjectBody(request)).documentIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => Number.isInteger(i))) {
    return Response.json({ error: "Pick at least one past exam" }, { status: 400 });
  }
  try {
    if (!(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
    return Response.json({ profile: await analyzePastExams(courseId, ids as number[]) });
  } catch (err) {
    if (err instanceof NoPastExamsError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Analysing past exams failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
