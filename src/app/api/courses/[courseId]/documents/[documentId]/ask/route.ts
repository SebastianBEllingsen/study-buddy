import { getDocument, getCourse } from "@/lib/models";
import { generateText, describeAiError } from "@/lib/aiClient";
import {
  hintSystemPrompt,
  explainSystemPrompt,
  explainImageSystemPrompt,
  askImageUserPrompt,
  askUserPrompt,
} from "@/lib/prompts/ask";
import { parseDataUrlImage } from "@/lib/dataUrlImage";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ documentId: string }> };

// Sibling of /api/items/[itemId]/ask, same shape — just resolves courseName
// from a document instead of a generated item. Only "explain" is offered
// by DocumentViewer's toolbar (see AskAiToolbar's kinds prop), but this
// route accepts both, same as the items route, rather than baking a
// frontend-only restriction into the backend.
export async function POST(request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return Response.json({ error: "Document not found" }, { status: 404 });
  const doc = await getDocument(id);
  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const body = await request.json();
  const kind = body?.kind;
  const context = typeof body?.context === "string" ? body.context.trim() : "";
  const selection = typeof body?.selection === "string" ? body.selection : undefined;
  const image = parseDataUrlImage(body?.image);
  const question = typeof body?.question === "string" ? body.question : undefined;

  if (kind !== "hint" && kind !== "explain") {
    return Response.json({ error: "kind must be 'hint' or 'explain'" }, { status: 400 });
  }
  // Screenshot-crop-to-ask (see PdfViewer.tsx): no extracted text exists for
  // an arbitrary cropped region, so an image takes the place of context —
  // only for "explain" (a hint has nothing to nudge toward without knowing
  // the question, so it's always text-based).
  if (image && kind !== "explain") {
    return Response.json({ error: "image is only supported with kind 'explain'" }, { status: 400 });
  }
  if (!image && !context) {
    return Response.json({ error: "context or image is required" }, { status: 400 });
  }

  const course = await getCourse(doc.course_id);
  const courseName = course?.name ?? "this course";

  try {
    const answer = image
      ? await generateText({
          system: explainImageSystemPrompt(courseName),
          user: askImageUserPrompt(question),
          images: [image],
          effort: "low",
          maxTokens: 500,
        })
      : await generateText({
          system: kind === "hint" ? hintSystemPrompt(courseName) : explainSystemPrompt(courseName),
          user: askUserPrompt({ context, selection }),
          effort: "low",
          maxTokens: 500,
        });
    return Response.json({ answer: answer.trim() });
  } catch (err) {
    console.error("Ask AI failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
