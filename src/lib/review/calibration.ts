import type { Confidence } from "./types";

// How well the learner's confidence matched their results — the feedback
// that makes "I thought I knew it" visible.

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  guess: "Guessing",
  unsure: "Unsure",
  sure: "Sure",
};

export interface CalibrationSummary {
  // answers with a confidence given
  rated: number;
  // "sure", but wrong: the dangerous blind spots
  sureWrong: number;
  // "guess"/"unsure", but right: knew more than they thought
  doubtedRight: number;
}

export function summarizeCalibration(answers: { confidence: Confidence | null; correct: boolean }[]): CalibrationSummary {
  const rated = answers.filter((a) => a.confidence !== null);
  return {
    rated: rated.length,
    sureWrong: rated.filter((a) => a.confidence === "sure" && !a.correct).length,
    doubtedRight: rated.filter((a) => a.confidence !== "sure" && a.correct).length,
  };
}

// One sentence for the end of a quiz or review session, or null when
// there's nothing worth saying.
export function calibrationMessage(summary: CalibrationSummary): string | null {
  if (summary.rated === 0) return null;
  const parts: string[] = [];
  if (summary.sureWrong > 0) {
    parts.push(
      `${summary.sureWrong} answer${summary.sureWrong === 1 ? "" : "s"} you were sure of ${summary.sureWrong === 1 ? "was" : "were"} wrong — they're in your mistake log`
    );
  }
  if (summary.doubtedRight > 0) {
    parts.push(`${summary.doubtedRight} you doubted ${summary.doubtedRight === 1 ? "was" : "were"} right`);
  }
  if (parts.length === 0) return "Your confidence matched your answers.";
  const sentence = parts.join("; ");
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}
