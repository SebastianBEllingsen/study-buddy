import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { parseTranscribeRequest } from "@/lib/transcribe/requests";
import { commitTranscription, restoreFileText, transcribeBatch, TranscribeError } from "@/lib/transcribe/service";

type Params = { params: Promise<{ courseId: string; documentId: string }> };

// Transcribing a document's pages with the AI (lib/transcribe/). The browser
// sends page images a few at a time ({ action: "batch", pages: [{ page,
// image }] } → { pages: [{ page, markdown }] }), then saves the result
// ({ action: "commit", pages }), which replaces the document's text;
// { action: "restore" } goes back to the file's own text layer.
export async function POST(request: Request, { params }: Params) {
  const { courseId, documentId } = await params;
  const course = parseId(courseId);
  const document = parseId(documentId);
  if (course === null || document === null) return Response.json({ error: "Document not found" }, { status: 404 });
  const req = parseTranscribeRequest(await parseJsonObjectBody(request));
  if (!req) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    if (req.action === "batch") return Response.json({ pages: await transcribeBatch(course, document, req.images) });
    if (req.action === "commit") return Response.json(await commitTranscription(course, document, req.pages));
    await restoreFileText(course, document);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof TranscribeError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: err.message.includes("not found") ? 404 : 400 });
    }
    console.error("Transcribing a document failed:", err);
    return Response.json({ error: await describeAiError(err, req.action === "batch") }, { status: 502 });
  }
}
