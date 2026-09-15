import { getDocument, markDocumentExtracted } from "@/lib/models";
import { tidyPastedText } from "@/lib/tidyText";
import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string; documentId: string }> };

// Only for pasted-text documents (file_path === "", see documents/paste/
// route.ts) — re-tidying a real PDF's extracted text would drift it from
// the actual file it's supposed to represent.
export async function POST(_request: Request, { params }: Params) {
  try {
    const { documentId } = await params;
    const id = parseId(documentId);
    if (id === null) return Response.json({ error: "Document not found" }, { status: 404 });
    const doc = await getDocument(id);
    if (!doc) {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.file_path !== "") {
      return Response.json(
        { error: "Only pasted text can be tidied this way" },
        { status: 400 }
      );
    }
    if (!doc.extracted_text?.trim()) {
      return Response.json({ error: "Nothing to tidy" }, { status: 400 });
    }

    const tidied = await tidyPastedText(doc.extracted_text);
    await markDocumentExtracted({
      id: doc.id,
      extractedText: tidied,
      pageCount: doc.page_count ?? 1,
      charCount: tidied.length,
    });

    return Response.json({ extractedText: tidied });
  } catch (err) {
    if (err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Tidying document text failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
