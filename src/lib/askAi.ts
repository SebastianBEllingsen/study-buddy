import { generateText, describeAiError, AiDisabledError } from "./aiClient";
import {
  hintSystemPrompt,
  explainSystemPrompt,
  explainImageSystemPrompt,
  askImageUserPrompt,
  askUserPrompt,
  type AskImageTurn,
} from "./prompts/ask";
import { parseDataUrlImage } from "./dataUrlImage";

// Shared by /api/items/[itemId]/ask and
// /api/courses/[courseId]/documents/[documentId]/ask — identical request
// shape and behavior, differing only in how each resolves `courseName`
// (from a generated item vs. a document) before calling this.

// Follow-up questions about the same cropped image (see useCropToAsk.ts) —
// each prior turn only ever comes back from this same route's own response
// shape ({answer: string}), so validating question/answer are both strings
// is enough; anything malformed is just dropped rather than rejecting the
// whole request over it.
function parsePriorTurns(value: unknown): AskImageTurn[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const turns = value.filter(
    (t): t is AskImageTurn =>
      !!t && typeof t === "object" && typeof t.question === "string" && typeof t.answer === "string"
  );
  return turns.length > 0 ? turns : undefined;
}

export async function askAi(courseName: string, body: unknown): Promise<Response> {
  const b = body as Record<string, unknown> | null;
  const kind = b?.kind;
  const context = typeof b?.context === "string" ? b.context.trim() : "";
  const selection = typeof b?.selection === "string" ? b.selection : undefined;
  const image = parseDataUrlImage(b?.image);
  const question = typeof b?.question === "string" ? b.question : undefined;
  const priorTurns = parsePriorTurns(b?.priorTurns);

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

  try {
    const answer = image
      ? await generateText({
          system: explainImageSystemPrompt(courseName),
          user: askImageUserPrompt(question, priorTurns),
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
    if (err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Ask AI failed:", err);
    return Response.json({ error: await describeAiError(err, !!image) }, { status: 502 });
  }
}
