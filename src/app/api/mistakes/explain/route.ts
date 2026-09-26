import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { explainMistakes } from "@/lib/review/explainMistakes";
import { parseJsonObjectBody } from "@/lib/requestBody";

// Labels the next batch of open mistakes with the misconception behind
// each. Body: { courseId?: number }.
export async function POST(request: Request) {
  const body = await parseJsonObjectBody(request);
  if (body.courseId !== undefined && body.courseId !== null && !Number.isInteger(body.courseId)) {
    return Response.json({ error: "courseId must be a course id" }, { status: 400 });
  }
  try {
    return Response.json(await explainMistakes((body.courseId as number | null | undefined) ?? null));
  } catch (err) {
    if (err instanceof AiDisabledError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Explaining mistakes failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
