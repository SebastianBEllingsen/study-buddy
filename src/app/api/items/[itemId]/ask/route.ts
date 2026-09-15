import { getGeneratedItem, getCourse } from "@/lib/models";
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
