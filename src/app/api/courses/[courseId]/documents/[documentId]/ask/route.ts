import { getDocument, getCourse } from "@/lib/models";
import { askAi } from "@/lib/askAi";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ documentId: string }> };

// Sibling of /api/items/[itemId]/ask, same shape — just resolves courseName
// from a document instead of a generated item. Only "explain" is offered
// by DocumentViewer's toolbar (see AskAiToolbar's kinds prop), but askAi
// accepts both, same as the items route, rather than baking a
// frontend-only restriction into the backend.
export async function POST(request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return Response.json({ error: "Document not found" }, { status: 404 });
  const doc = await getDocument(id);
  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const course = await getCourse(doc.course_id);
  const courseName = course?.name ?? "this course";
  const body = await request.json().catch(() => ({}));
  return askAi(courseName, body);
}
