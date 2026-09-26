import { getAttempt, setAttemptPaused } from "@/lib/exams/store";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ attemptId: string }> };

// Pauses or resumes an open attempt's clock. Body: { paused: boolean }.
export async function POST(request: Request, { params }: Params) {
  const id = parseId((await params).attemptId);
  const attempt = id === null ? null : await getAttempt(id);
  if (!attempt) return Response.json({ error: "Attempt not found" }, { status: 404 });
  const { paused } = await parseJsonObjectBody(request);
  if (typeof paused !== "boolean") return Response.json({ error: "paused must be a boolean" }, { status: 400 });
  if (attempt.status !== "in_progress") {
    return Response.json({ error: "This attempt has been handed in" }, { status: 409 });
  }
  await setAttemptPaused(attempt, paused);
  return Response.json({ attempt: await getAttempt(attempt.id) });
}
