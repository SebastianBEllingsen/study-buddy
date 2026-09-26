// Shared, client-safe types for spaced review (lib/fsrs.ts, lib/review/*).

// What a review_items row points at inside a generated item: a flashcard
// (content.cards[i]) or a quiz question (content.questions[i]).
export type ReviewItemKind = "card" | "question";
export const REVIEW_ITEM_KINDS: ReviewItemKind[] = ["card", "question"];

// The learner's own confidence, tapped before seeing whether they were
// right. Feeds the FSRS rating for quiz answers and the calibration of the
// mistake log.
export type Confidence = "guess" | "unsure" | "sure";
export const CONFIDENCES: Confidence[] = ["guess", "unsure", "sure"];

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === "string" && (CONFIDENCES as string[]).includes(value);
}

// Where a graded answer came from (review_logs.source).
export type ReviewSource = "deck" | "quiz" | "queue" | "legacy" | "exam";

// FSRS target retention: the recall probability reviews are scheduled at.
export const DEFAULT_RETENTION = 0.9;
export const MIN_RETENTION = 0.8;
export const MAX_RETENTION = 0.97;
