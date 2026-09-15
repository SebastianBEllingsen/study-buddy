import { getDocument } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ documentId: string }> };

// Course-agnostic document metadata lookup — unlike
// courses/[courseId]/documents/[documentId] (which serves the actual PDF
// bytes and needs courseId to scope that), this just needs the id: the
// detached document view (app/documents/[documentId]/view) only has a
// documentId from its own URL, not the course it belongs to.
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return Response.json({ error: "Document not found" }, { status: 404 });

  const doc = await getDocument(id);
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  return Response.json({
    document: {
      id: doc.id,
      courseId: doc.course_id,
      filename: doc.filename,
      extracted_text: doc.extracted_text,
      filePath: doc.file_path,
    },
  });
}
