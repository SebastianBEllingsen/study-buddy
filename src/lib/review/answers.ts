import { getAppSettings, logFlashcardReview, type FlashcardResult, type GeneratedItem } from "../models";
import { fromUtcText, Rating, ratingFromAnswer, ratingFromFlashcardResult } from "../fsrs";
import { answerText, verdictOf, type AttemptResultEntry, type QuizAnswer } from "../quizGrading";
import { cleanConceptName, conceptKey } from "../conceptName";
import type { Flashcard, QuizQuestion } from "../types";
import { findOrCreateConcepts } from "./concepts";
import { autoResolveMistakes, logMistake } from "./mistakes";
import { ensureFsrsMigrated } from "./legacyMigration";
import { getReviewItem, recordReview } from "./store";
import type { Confidence, ReviewItemKind, ReviewSource } from "./types";

// Turns answers — a flashcard self-rating, a graded quiz question — into
// FSRS reviews, mistake-log entries and mistake auto-resolution. The one
// place every answer path (a deck, a quiz attempt, the review session)
// goes through.

// Answering the same card/question again within this window (a retake, a
// re-ask in the same session, "review all") doesn't move its schedule:
// only the first answer counts, so cramming can't inflate an interval.
export const SAME_SESSION_MS = 6 * 60 * 60 * 1000;

async function conceptIds(item: GeneratedItem, names: (string | undefined)[]): Promise<Map<string, number>> {
  const clean = names.map(cleanConceptName).filter((n): n is string => !!n);
  if (clean.length === 0) return new Map();
  const chapterIds = new Map<string, number>();
  if (item.study_plan_chapter_id !== null) {
    for (const name of clean) chapterIds.set(conceptKey(name), item.study_plan_chapter_id);
  }
  return findOrCreateConcepts(item.course_id, clean, chapterIds);
}

function conceptIdOf(ids: Map<string, number>, name: string | undefined): number | null {
  const clean = cleanConceptName(name);
  return clean ? (ids.get(conceptKey(clean)) ?? null) : null;
}

async function answeredRecently(generatedItemId: number, kind: ReviewItemKind, index: number, now: Date) {
  const existing = await getReviewItem(generatedItemId, kind, index);
  return (
    !!existing?.last_reviewed_at && now.getTime() - fromUtcText(existing.last_reviewed_at).getTime() < SAME_SESSION_MS
  );
}

export interface RecordedAnswer {
  index: number;
  // false when the answer came too soon after the last one to count
  scheduled: boolean;
  dueAt: string | null;
}

export async function recordCardAnswer(input: {
  item: GeneratedItem;
  card: Flashcard;
  cardIndex: number;
  result: FlashcardResult;
  confidence: Confidence | null;
  source: ReviewSource;
  now?: Date;
}): Promise<RecordedAnswer> {
  const now = input.now ?? new Date();
  await ensureFsrsMigrated();
  // The flashcard_reviews log still feeds the activity heatmap, streak and
  // study plan mastery, whatever the schedule does.
  await logFlashcardReview({ generatedItemId: input.item.id, cardIndex: input.cardIndex, result: input.result });
  if (await answeredRecently(input.item.id, "card", input.cardIndex, now)) {
    return { index: input.cardIndex, scheduled: false, dueAt: null };
  }

  const { reviewRetention } = await getAppSettings();
  const ids = await conceptIds(input.item, [input.card.concept]);
  const conceptId = conceptIdOf(ids, input.card.concept);
  const rating = ratingFromFlashcardResult(input.result);
  const correct = rating !== Rating.Again;
  const row = await recordReview({
    generatedItemId: input.item.id,
    kind: "card",
    itemIndex: input.cardIndex,
    rating,
    correct,
    confidence: input.confidence,
    source: input.source,
    conceptId,
    retention: reviewRetention,
    now,
  });
  if (correct) {
    await autoResolveMistakes(row.id);
  } else {
    await logMistake({
      generatedItemId: input.item.id,
      reviewItemId: row.id,
      conceptId,
      kind: "card",
      itemIndex: input.cardIndex,
      prompt: input.card.front,
      givenAnswer: null,
      correctAnswer: input.card.back,
      confidence: input.confidence,
    });
  }
  return { index: input.cardIndex, scheduled: true, dueAt: row.due_at };
}

export async function recordQuizAnswers(input: {
  item: GeneratedItem;
  entries: { question: QuizQuestion; answer: QuizAnswer; confidence: Confidence | null; result: AttemptResultEntry }[];
  source: ReviewSource;
  now?: Date;
}): Promise<RecordedAnswer[]> {
  const now = input.now ?? new Date();
  const { reviewRetention } = await getAppSettings();
  const ids = await conceptIds(
    input.item,
    input.entries.map((e) => e.question.concept)
  );
  const recorded: RecordedAnswer[] = [];
  for (const { question, answer, confidence, result } of input.entries) {
    const index = result.index;
    // A flagged question is held out of review: its answer isn't
    // scheduled or logged as a mistake until the flag is resolved.
    if (question.flag || (await answeredRecently(input.item.id, "question", index, now))) {
      recorded.push({ index, scheduled: false, dueAt: null });
      continue;
    }
    const verdict = verdictOf(result);
    const conceptId = conceptIdOf(ids, question.concept);
    const row = await recordReview({
      generatedItemId: input.item.id,
      kind: "question",
      itemIndex: index,
      rating: ratingFromAnswer(verdict, confidence),
      correct: verdict === "correct",
      confidence,
      source: input.source,
      conceptId,
      retention: reviewRetention,
      now,
    });
    if (verdict === "correct") {
      await autoResolveMistakes(row.id);
    } else {
      await logMistake({
        generatedItemId: input.item.id,
        reviewItemId: row.id,
        conceptId,
        kind: "question",
        itemIndex: index,
        prompt: question.question,
        givenAnswer: answerText(question, answer),
        correctAnswer: result.correctAnswer,
        confidence,
      });
    }
    recorded.push({ index, scheduled: true, dueAt: row.due_at });
  }
  return recorded;
}
