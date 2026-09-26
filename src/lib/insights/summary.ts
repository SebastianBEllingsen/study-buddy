import { CONFIDENCES, type Confidence } from "../review/types";

// Pure pieces of the insights page (lib/insights/load.ts): calibration and
// the weekly review. Client-safe.

export interface CalibrationRow {
  confidence: Confidence;
  answers: number;
  correct: number;
  // Share correct, or null with no answers.
  accuracy: number | null;
}

// How often you were right at each confidence level. Well calibrated means
// "sure" is nearly always right and "guess" often isn't.
export function calibrationTable(logs: { confidence: string | null; correct: boolean }[]): CalibrationRow[] {
  return CONFIDENCES.map((confidence) => {
    const rows = logs.filter((l) => l.confidence === confidence);
    const correct = rows.filter((l) => l.correct).length;
    return { confidence, answers: rows.length, correct, accuracy: rows.length ? correct / rows.length : null };
  });
}

// The headline: where confidence and results disagree most.
export function calibrationVerdict(table: CalibrationRow[]): string | null {
  const sure = table.find((r) => r.confidence === "sure");
  const guess = table.find((r) => r.confidence === "guess");
  if (!sure || table.every((r) => r.answers < 5)) return null;
  if (sure.accuracy !== null && sure.answers >= 5 && sure.accuracy < 0.8) {
    return `When you're sure, you're right ${Math.round(sure.accuracy * 100)}% of the time — you're overconfident. Slow down on answers that feel easy.`;
  }
  if (guess?.accuracy != null && guess.answers >= 5 && guess.accuracy > 0.7) {
    return `Your guesses are right ${Math.round(guess.accuracy * 100)}% of the time — you know more than you think.`;
  }
  return "Your confidence matches your results well.";
}

export interface WeekSummary {
  reviews: number;
  reviewAccuracy: number | null;
  quizzes: number;
  mockExams: number;
  explained: number;
  newMistakes: number;
  resolvedMistakes: number;
  plannedMinutes: number;
  doneMinutes: number;
  activeDays: number;
}

export function topMisconceptions(
  mistakes: { misconception: string | null; concept_name: string | null; created_at: string }[],
  limit = 5
): { misconception: string; concept: string | null }[] {
  return mistakes
    .filter((m) => m.misconception)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map((m) => ({ misconception: m.misconception as string, concept: m.concept_name }));
}
