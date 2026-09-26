import { getCourse } from "@/lib/models";
import { ExplainSessionError, startExplainSession } from "@/lib/explain/flow";
import { listExplainSessions } from "@/lib/explain/store";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  return Response.json({ sessions: await listExplainSessions(courseId) });
}

// Starts a blurt or Feynman session. Body: { kind, chapterId?, topic? }.
export async function POST(request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null || !(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  if (body.kind !== "blurt" && body.kind !== "feynman") return Response.json({ error: "Unknown kind" }, { status: 400 });
  if (body.chapterId !== undefined && body.chapterId !== null && !Number.isInteger(body.chapterId)) {
    return Response.json({ error: "Invalid chapter" }, { status: 400 });
  }
  try {
    const session = await startExplainSession({
      courseId,
      kind: body.kind,
      chapterId: (body.chapterId as number | null | undefined) ?? null,
      topic: typeof body.topic === "string" ? body.topic : undefined,
    });
    return Response.json({ session }, { status: 201 });
  } catch (err) {
    if (err instanceof ExplainSessionError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
