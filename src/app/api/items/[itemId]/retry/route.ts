import { getGeneratedItem } from "@/lib/models";
import { createRetryQuiz, NoMissedQuestionsError } from "@/lib/generate";
import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return Response.json({ error: "Quiz item not found" }, { status: 404 });
  const item = await getGeneratedItem(id);
  if (!item || item.mode !== "quiz") {
    return Response.json({ error: "Quiz item not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const missedIndices: number[] = Array.isArray(body?.missedIndices)
    ? body.missedIndices.filter((i: unknown) => Number.isInteger(i))
    : [];

  try {
    const retryItem = await createRetryQuiz(item, missedIndices);
    return Response.json(retryItem, { status: 201 });
  } catch (err) {
    if (err instanceof NoMissedQuestionsError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Retry quiz generation failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
