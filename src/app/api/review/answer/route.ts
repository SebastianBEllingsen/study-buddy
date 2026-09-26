import { getGeneratedItem, type FlashcardResult } from "@/lib/models";
import { describeAiError } from "@/lib/aiClient";
import { gradeQuizAnswers, type QuizAnswer } from "@/lib/quizGrading";
import { recordCardAnswer, recordQuizAnswers } from "@/lib/review/answers";
import { isConfidence } from "@/lib/review/types";
import { parseJsonObjectBody } from "@/lib/requestBody";
import type { FlashcardsContent, QuizContent } from "@/lib/types";

const RESULTS: FlashcardResult[] = ["again", "hard", "good", "easy"];

function isQuizAnswer(value: unknown): value is QuizAnswer {
  return (
    value === null ||
    typeof value === "string" ||
    Number.isInteger(value) ||
    (Array.isArray(value) && value.every((v) => Number.isInteger(v)))
  );
}

// One answer from the review session: a card's self-rating, or a quiz
// question's answer (graded here). `record: false` grades without
// scheduling — the session re-asks what was missed until it's right, and
// only the first answer counts.
export async function POST(request: Request) {
  const body = await parseJsonObjectBody(request);
  const itemId = body.itemId;
  const index = body.index;
  const confidence = body.confidence ?? null;
  const record = body.record !== false;
  if (
    !Number.isInteger(itemId) ||
    !Number.isInteger(index) ||
    (index as number) < 0 ||
    (body.kind !== "card" && body.kind !== "question") ||
    (confidence !== null && !isConfidence(confidence))
  ) {
    return Response.json({ error: "Invalid answer" }, { status: 400 });
  }

  try {
    const item = await getGeneratedItem(itemId as number);
    if (!item || item.mode !== (body.kind === "card" ? "flashcards" : "quiz")) {
      return Response.json({ error: "Item not found" }, { status: 404 });
    }

    if (body.kind === "card") {
      const cards = (JSON.parse(item.content_json) as FlashcardsContent).cards;
      const card = cards[index as number];
      if (!card || !RESULTS.includes(body.result as FlashcardResult)) {
        return Response.json({ error: "Invalid answer" }, { status: 400 });
      }
      if (!record) return Response.json({ scheduled: false, dueAt: null });
      const recorded = await recordCardAnswer({
        item,
        card,
        cardIndex: index as number,
        result: body.result as FlashcardResult,
        confidence,
        source: "queue",
      });
      return Response.json({ scheduled: recorded.scheduled, dueAt: recorded.dueAt });
    }

    const question = (JSON.parse(item.content_json) as QuizContent).questions[index as number];
    if (!question || !isQuizAnswer(body.answer ?? null)) {
      return Response.json({ error: "Invalid answer" }, { status: 400 });
    }
    const answer = (body.answer ?? null) as QuizAnswer;
    const [result] = await gradeQuizAnswers([{ index: index as number, question, answer }]);
    let recorded = { scheduled: false, dueAt: null as string | null };
    if (record) {
      [recorded] = await recordQuizAnswers({
        item,
        entries: [{ question, answer, confidence, result }],
        source: "queue",
      });
    }
    return Response.json({ result, scheduled: recorded.scheduled, dueAt: recorded.dueAt });
  } catch (err) {
    console.error("Recording a review answer failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
