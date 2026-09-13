import {
  logFlashcardReview,
  getFlashcardSchedule,
  upsertFlashcardSchedule,
} from "@/lib/models";
import type { FlashcardResult } from "@/lib/models";
import { computeNextSchedule, dueAtFromInterval, DEFAULT_SCHEDULE } from "@/lib/spacedRepetition";

type Params = { params: Promise<{ itemId: string }> };

const VALID_RESULTS: FlashcardResult[] = ["again", "hard", "good", "easy"];

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  try {
    const body = await request.json();
    const cardIndex = Number(body?.cardIndex);
    const result = body?.result as FlashcardResult;

    if (!Number.isInteger(cardIndex) || !VALID_RESULTS.includes(result)) {
      return Response.json({ error: "Invalid review payload" }, { status: 400 });
    }

    const generatedItemId = Number(itemId);
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
