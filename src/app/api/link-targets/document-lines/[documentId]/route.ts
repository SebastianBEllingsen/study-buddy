import { getDocumentLines } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ documentId: string }> };

// The "Insert link" dialog's optional second step: search within a chosen
// document's own text for the specific sentence/line a note should deep
// link to, rather than just the document as a whole.
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return Response.json({ lines: [] });
  return Response.json({ lines: await getDocumentLines(id) });
}
