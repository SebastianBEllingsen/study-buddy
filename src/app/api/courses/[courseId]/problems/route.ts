import { getCourse } from "@/lib/models";
import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { ProblemSetError, createCoachSet, createMixedSet } from "@/lib/problems/service";
import { listProblemSets } from "@/lib/problems/store";
import { publicSet } from "@/lib/problems/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const sets = await listProblemSets(courseId);
  return Response.json({
    sets: sets.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      created_at: s.created_at,
      total: s.problems.length,
      done: s.progress.filter((p) => p.done).length,
    })),
  });
}

// Writes a problem set. Body: { kind: "coach", chapterId? | topic? } or { kind: "mixed" }.
export async function POST(request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null || !(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  if (body.chapterId !== undefined && body.chapterId !== null && !Number.isInteger(body.chapterId)) {
    return Response.json({ error: "Invalid chapter" }, { status: 400 });
  }
  try {
    const set =
      body.kind === "mixed"
        ? await createMixedSet(courseId)
        : body.kind === "coach"
          ? await createCoachSet(courseId, {
              chapterId: (body.chapterId as number | null | undefined) ?? null,
              topic: typeof body.topic === "string" ? body.topic : undefined,
            })
          : null;
    if (!set) return Response.json({ error: "Unknown kind" }, { status: 400 });
    return Response.json({ set: publicSet(set) }, { status: 201 });
  } catch (err) {
    if (err instanceof ProblemSetError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Writing a problem set failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
