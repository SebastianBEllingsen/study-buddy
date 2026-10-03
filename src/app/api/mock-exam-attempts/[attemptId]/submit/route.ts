import { getAppSettings } from "@/lib/models";
import { gradeAttempt } from "@/lib/exams/grade";
import { claimForGrading, getAttempt, getMockExam, saveAnswers } from "@/lib/exams/store";
import { parseAnswers } from "@/lib/exams/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ attemptId: string }> };

// Hands the attempt in (with its final answers, if sent) and grades it in
// the background; the page polls the attempt until it's graded. Also
// retries grading after a failure.
export async function POST(request: Request, { params }: Params) {
  const id = parseId((await params).attemptId);
  if (id === null) return Response.json({ error: "Attempt not found" }, { status: 404 });
  const attempt = await getAttempt(id);
  const exam = attempt && (await getMockExam(attempt.mock_exam_id));
  if (!attempt || !exam) return Response.json({ error: "Attempt not found" }, { status: 404 });
  if (attempt.status === "grading" || attempt.status === "graded") {
    return Response.json({ error: "This attempt has already been handed in" }, { status: 409 });
  }
  if (!(await getAppSettings()).aiEnabled) {
    return Response.json({ error: "Grading needs AI, which is turned off in Settings" }, { status: 400 });
  }
  const body = await parseJsonObjectBody(request);
  let answers = null;
  if (body.answers !== undefined) {
    if (attempt.status !== "in_progress") return Response.json({ error: "Invalid answers" }, { status: 400 });
    answers = parseAnswers(body.answers, exam.tasks.length);
    if (!answers) return Response.json({ error: "Invalid answers" }, { status: 400 });
  }
  // Claimed in the database: a second hand-in racing this one (a double
  // click, or another computer) is turned away instead of grading — and
  // paying for — the attempt twice.
  if (!(await claimForGrading(attempt.id, { submitted: attempt.status === "in_progress" }))) {
    return Response.json({ error: "This attempt has already been handed in" }, { status: 409 });
  }
  if (answers) await saveAnswers(attempt.id, answers);
  void gradeAttempt(attempt.id).catch((err) => console.error("Mock exam: grading crashed:", err));
  return Response.json({ ok: true }, { status: 202 });
}
