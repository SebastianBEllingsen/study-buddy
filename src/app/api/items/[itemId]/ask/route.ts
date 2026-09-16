import { getGeneratedItem, getCourse } from "@/lib/models";
import { generateText, describeAiError, AiDisabledError } from "@/lib/aiClient";
import {
  hintSystemPrompt,
  explainSystemPrompt,
  explainImageSystemPrompt,
  askImageUserPrompt,
  askUserPrompt,
  type AskImageTurn,
} from "@/lib/prompts/ask";
import { parseDataUrlImage } from "@/lib/dataUrlImage";
import { parseId } from "@/lib/routeParams";

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

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return Response.json({ error: "Item not found" }, { status: 404 });
  const item = await getGeneratedItem(id);
  if (!item) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }

  const body = await request.json();
  const kind = body?.kind;
  const context = typeof body?.context === "string" ? body.context.trim() : "";
  const selection = typeof body?.selection === "string" ? body.selection : undefined;
  const image = parseDataUrlImage(body?.image);
  const question = typeof body?.question === "string" ? body.question : undefined;
  const priorTurns = parsePriorTurns(body?.priorTurns);

  if (kind !== "hint" && kind !== "explain") {
    return Response.json({ error: "kind must be 'hint' or 'explain'" }, { status: 400 });
  }
  // See the sibling documents/[documentId]/ask/route.ts for why image is
  // "explain"-only.
  if (image && kind !== "explain") {
    return Response.json({ error: "image is only supported with kind 'explain'" }, { status: 400 });
  }
  if (!image && !context) {
    return Response.json({ error: "context or image is required" }, { status: 400 });
  }

  const course = await getCourse(item.course_id);
  const courseName = course?.name ?? "this course";

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
