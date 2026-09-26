import { createAttempt, getMockExam } from "@/lib/exams/store";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ examId: string }> };

// Starts a timed sitting of the exam.
export async function POST(_request: Request, { params }: Params) {
  const id = parseId((await params).examId);
  if (id === null) return Response.json({ error: "Exam not found" }, { status: 404 });
  const exam = await getMockExam(id);
  if (!exam) return Response.json({ error: "Exam not found" }, { status: 404 });
  const attempt = await createAttempt(exam.id, exam.tasks.length);
  return Response.json({ attempt }, { status: 201 });
}
