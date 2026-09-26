import type { FlashcardResult } from "../models";

// How well a study-plan chapter is known, from the quizzes and flashcards
// generated for it: a 0–1 score, or null with no results yet. Recent
// results count more than old ones (half weight every HALF_LIFE_DAYS), so
// the number drifts down if a chapter isn't revisited and recovers with
// practice. A finished quiz weighs as much as QUIZ_WEIGHT card reviews,
// since it's a deliberate test of the whole chapter.

export const HALF_LIFE_DAYS = 14;
const QUIZ_WEIGHT = 5;

const CARD_VALUE: Record<FlashcardResult, number> = {
  again: 0,
  hard: 0.5,
  good: 0.8,
  easy: 1,
};

export interface ChapterActivity {
  // Percentages 0–100, as quiz_attempts stores them.
  quizScores: { score: number; at: string }[];
  flashcardResults: { result: FlashcardResult; at: string }[];
}

// "YYYY-MM-DD HH:MM:SS" UTC (lib/time.ts).
function ageDays(timestamp: string, now: Date): number {
  const at = Date.parse(`${timestamp.replace(" ", "T")}Z`);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, (now.getTime() - at) / (24 * 60 * 60 * 1000));
}

function recency(timestamp: string, now: Date): number {
  return Math.pow(0.5, ageDays(timestamp, now) / HALF_LIFE_DAYS);
}

export function computeChapterMastery(activity: ChapterActivity, now: Date = new Date()): number | null {
  let weighted = 0;
  let total = 0;
  for (const { score, at } of activity.quizScores) {
    const w = QUIZ_WEIGHT * recency(at, now);
    weighted += w * Math.min(1, Math.max(0, score / 100));
    total += w;
  }
  for (const { result, at } of activity.flashcardResults) {
    const w = recency(at, now);
    weighted += w * (CARD_VALUE[result] ?? 0);
    total += w;
  }
  return total === 0 ? null : weighted / total;
}

export type MasteryLevel = "none" | "weak" | "fair" | "strong";

export function masteryLevel(mastery: number | null): MasteryLevel {
  if (mastery === null) return "none";
  if (mastery < 0.5) return "weak";
  if (mastery < 0.8) return "fair";
  return "strong";
}
