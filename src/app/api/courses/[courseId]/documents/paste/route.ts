import { createDocument, markDocumentExtracted } from "@/lib/models";

type Params = { params: Promise<{ courseId: string }> };

// A JSON sibling of the file-upload route, not a mode flag on it — this
// request has no file, just a title/text pair, so it doesn't share that
// route's multipart/form-data shape. Stores the pasted text exactly like an
// already-extracted PDF (filePath: "" and fileBase64: null instead of a
// real file — see createDocument/the GET file route, which already treats
// "no file on disk and no file_base64" as "show extracted text"), so it
// flows into generation/search/viewing identically with no changes there.
export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = Number(courseId);

  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const folderId = Number(body?.folderId);

  if (!title) {
    return Response.json({ error: "A title is required" }, { status: 400 });
  }
  if (!text) {
    return Response.json({ error: "Paste some text first" }, { status: 400 });
  }
  if (!Number.isInteger(folderId)) {
    return Response.json({ error: "A folder is required" }, { status: 400 });
  }

  try {
    const doc = await createDocument({
      courseId: id,
      folderId,
      filename: title,
      filePath: "",
      fileBase64: null,
    });

    await markDocumentExtracted({
      id: doc.id,
      extractedText: text,
      pageCount: 1,
      charCount: text.length,
    });

    return Response.json({ documentId: doc.id }, { status: 201 });
  } catch (err) {
    console.error("Paste-text document creation failed:", err);
    return Response.json({ error: "Couldn't add this text" }, { status: 500 });
  }
}
