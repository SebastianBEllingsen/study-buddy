import { getCourse } from "@/lib/models";
import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { CodeSetError, generateCodeSet } from "@/lib/code/service";
import { listCodeSets } from "@/lib/code/store";
import { parseNewCodeSet } from "@/lib/code/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const sets = await listCodeSets(courseId);
  return Response.json({
    sets: sets.map((s) => ({
      id: s.id,
      title: s.title,
      language: s.language,
      created_at: s.created_at,
      total: s.exercises.length,
      done: s.progress.filter((p) => p.done).length,
    })),
  });
}

// Writes a set of code exercises. Body: { language, chapterId? | topic }.
export async function POST(request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null || !(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
  const input = parseNewCodeSet(await parseJsonObjectBody(request));
  if (!input) return Response.json({ error: "Pick a language and a chapter or topic" }, { status: 400 });
  try {
    return Response.json({ set: await generateCodeSet(courseId, input) }, { status: 201 });
  } catch (err) {
    if (err instanceof CodeSetError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Writing code exercises failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
