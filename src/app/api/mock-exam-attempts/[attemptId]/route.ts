import { deleteAttempt, getAttempt, getMockExam, saveAnswers } from "@/lib/exams/store";
import { examForAttempt, parseAnswers } from "@/lib/exams/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ attemptId: string }> };

async function load(params: Params["params"]) {
  const id = parseId((await params).attemptId);
  if (id === null) return null;
  const attempt = await getAttempt(id);
  if (!attempt) return null;
  const exam = await getMockExam(attempt.mock_exam_id);
  return exam ? { attempt, exam } : null;
}

// The attempt with its exam — rubrics and solutions only once graded.
export async function GET(_request: Request, { params }: Params) {
  const found = await load(params);
  if (!found) return Response.json({ error: "Attempt not found" }, { status: 404 });
  return Response.json({ attempt: found.attempt, exam: examForAttempt(found.exam, found.attempt) });
}

// Saves answers while the attempt is open. Body: { answers: TaskAnswer[] }.
export async function PATCH(request: Request, { params }: Params) {
  const found = await load(params);
  if (!found) return Response.json({ error: "Attempt not found" }, { status: 404 });
  if (found.attempt.status !== "in_progress") {
    return Response.json({ error: "This attempt has been handed in" }, { status: 409 });
  }
  const answers = parseAnswers((await parseJsonObjectBody(request)).answers, found.exam.tasks.length);
  if (!answers) return Response.json({ error: "Invalid answers" }, { status: 400 });
  await saveAnswers(found.attempt.id, answers);
  return Response.json({ ok: true });
}

// Throws away an attempt that hasn't been graded (to start over).
export async function DELETE(_request: Request, { params }: Params) {
  const found = await load(params);
  if (!found) return Response.json({ error: "Attempt not found" }, { status: 404 });
  if (found.attempt.status === "graded" || found.attempt.status === "grading") {
    return Response.json({ error: "A handed-in attempt can't be discarded" }, { status: 409 });
  }
  await deleteAttempt(found.attempt.id);
  return Response.json({ ok: true });
}
