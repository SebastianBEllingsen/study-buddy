import { getAppSettings, getGeneratedItem } from "@/lib/models";
import { AiDisabledError, describeAiError, generateStructured } from "@/lib/aiClient";
import { languageName } from "@/lib/languages";
import { normalizeWhy, whySystemPrompt, whyUserPrompt } from "@/lib/prompts/why";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import type { FlashcardsContent } from "@/lib/types";

type Params = { params: Promise<{ itemId: string }> };

// Why a card's answer is true, with feedback on the learner's own reasoning.
// Body: { cardIndex: number, attempt?: string }.
export async function POST(request: Request, { params }: Params) {
  const id = parseId((await params).itemId);
  const item = id === null ? undefined : await getGeneratedItem(id);
  if (!item || item.mode !== "flashcards") return Response.json({ error: "Item not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  const card = Number.isInteger(body.cardIndex)
    ? (JSON.parse(item.content_json) as FlashcardsContent).cards[body.cardIndex as number]
    : undefined;
  const attempt = body.attempt === undefined ? "" : body.attempt;
  if (!card || typeof attempt !== "string") return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
    const why = normalizeWhy(
      await generateStructured<unknown>({
        system: whySystemPrompt(languageName(preferredLanguage)),
        user: whyUserPrompt(card.front, card.back, attempt),
        maxTokens: 1200,
        effort: "low",
        efficient,
      })
    );
    if (!why) return Response.json({ error: "The AI didn't give an explanation — try again" }, { status: 502 });
    return Response.json(why);
  } catch (err) {
    if (err instanceof AiDisabledError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Why? failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
