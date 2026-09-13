import { getDocumentLines } from "@/lib/models";

type Params = { params: Promise<{ documentId: string }> };

// The "Insert link" dialog's optional second step: search within a chosen
// document's own text for the specific sentence/line a note should deep
// link to, rather than just the document as a whole.
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  return Response.json({ lines: await getDocumentLines(Number(documentId)) });
}
