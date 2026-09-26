import { deleteMockExam, getMockExam } from "@/lib/exams/store";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ examId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const id = parseId((await params).examId);
  if (id === null || !(await getMockExam(id))) return Response.json({ error: "Exam not found" }, { status: 404 });
  await deleteMockExam(id);
  return Response.json({ ok: true });
}
