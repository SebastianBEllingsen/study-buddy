import {
  logFlashcardReview,
  getFlashcardSchedule,
  upsertFlashcardSchedule,
  getGeneratedItem,
} from "@/lib/models";
import type { FlashcardResult } from "@/lib/models";
import type { FlashcardsContent } from "@/lib/types";
import { computeNextSchedule, dueAtFromInterval, DEFAULT_SCHEDULE } from "@/lib/spacedRepetition";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

const VALID_RESULTS: FlashcardResult[] = ["again", "hard", "good", "easy"];

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  const generatedItemId = parseId(itemId);
  if (generatedItemId === null) return Response.json({ error: "Item not found" }, { status: 404 });
  try {
    // The item was never loaded before this — cardIndex was only checked
    // for being an integer, not >= 0 or within this deck's actual card
    // count, so an arbitrary cardIndex (or an itemId for a quiz/notes item,
    // not flashcards at all) could create flashcard_schedule/
    // flashcard_reviews rows for a card that doesn't exist, inflating due
    // counts (computeDueCardIndices) for nothing a student can actually review.
    const item = await getGeneratedItem(generatedItemId);
    if (!item || item.mode !== "flashcards") {
      return Response.json({ error: "Item not found" }, { status: 404 });
    }
    const cardCount = (JSON.parse(item.content_json) as FlashcardsContent).cards.length;

    const body = await request.json();
    const cardIndex = Number(body?.cardIndex);
    const result = body?.result as FlashcardResult;

    if (
      !Number.isInteger(cardIndex) ||
      cardIndex < 0 ||
      cardIndex >= cardCount ||
      !VALID_RESULTS.includes(result)
    ) {
      return Response.json({ error: "Invalid review payload" }, { status: 400 });
    }

    await logFlashcardReview({ generatedItemId, cardIndex, result });

    const current = await getFlashcardSchedule(generatedItemId, cardIndex);
    const next = computeNextSchedule(
      current
        ? {
            easeFactor: current.ease_factor,
            intervalDays: current.interval_days,
            repetitions: current.repetitions,
          }
        : DEFAULT_SCHEDULE,
      result
    );
    const dueAt = dueAtFromInterval(next.intervalDays);
    await upsertFlashcardSchedule({
      generatedItemId,
      cardIndex,
      easeFactor: next.easeFactor,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      dueAt,
    });

    return Response.json({ ok: true, dueAt });
  } catch (err) {
    console.error("Logging flashcard review failed:", err);
    return Response.json({ error: "Couldn't save this review" }, { status: 500 });
  }
}
