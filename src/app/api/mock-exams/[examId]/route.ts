import { deleteMockExam, getMockExam, listAttemptsForExam } from "@/lib/exams/store";
import { removeUnreferencedBlobs } from "@/lib/blobStorage/cleanup";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ examId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const id = parseId((await params).examId);
  if (id === null || !(await getMockExam(id))) return Response.json({ error: "Exam not found" }, { status: 404 });
  const attempts = await listAttemptsForExam(id);
  await deleteMockExam(id);
  await removeUnreferencedBlobs(attempts.map((a) => JSON.stringify(a.answers)));
  return Response.json({ ok: true });
}
