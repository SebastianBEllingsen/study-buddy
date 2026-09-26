import { getGeneratedItem } from "@/lib/models";
import type { FlashcardResult } from "@/lib/models";
import type { FlashcardsContent } from "@/lib/types";
import { recordCardAnswer } from "@/lib/review/answers";
import { isConfidence } from "@/lib/review/types";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

const VALID_RESULTS: FlashcardResult[] = ["again", "hard", "good", "easy"];

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  const generatedItemId = parseId(itemId);
  if (generatedItemId === null) return Response.json({ error: "Item not found" }, { status: 404 });
  try {
    // The item is loaded first so cardIndex can be checked against this
    // deck's real cards — an arbitrary index (or a quiz/notes item) must
    // not create review state for a card that doesn't exist.
    const item = await getGeneratedItem(generatedItemId);
    if (!item || item.mode !== "flashcards") {
      return Response.json({ error: "Item not found" }, { status: 404 });
    }
    const cards = (JSON.parse(item.content_json) as FlashcardsContent).cards;

    const body = await request.json();
    const cardIndex = Number(body?.cardIndex);
    const result = body?.result as FlashcardResult;
    const confidence = body?.confidence ?? null;

    if (
      !Number.isInteger(cardIndex) ||
      cardIndex < 0 ||
      cardIndex >= cards.length ||
      !VALID_RESULTS.includes(result) ||
      (confidence !== null && !isConfidence(confidence))
    ) {
      return Response.json({ error: "Invalid review payload" }, { status: 400 });
    }

    const recorded = await recordCardAnswer({
      item,
      card: cards[cardIndex],
      cardIndex,
      result,
      confidence,
      source: "deck",
    });
    return Response.json({ ok: true, dueAt: recorded.dueAt, scheduled: recorded.scheduled });
  } catch (err) {
    console.error("Logging flashcard review failed:", err);
    return Response.json({ error: "Couldn't save this review" }, { status: 500 });
  }
}
