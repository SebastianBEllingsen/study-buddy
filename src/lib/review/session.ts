import type { Confidence } from "./types";
import { summarizeCalibration, type CalibrationSummary } from "./calibration";

// Client-side bookkeeping for one review session: what was missed comes
// back a few items later (until it's answered right), and only the first
// answer to each item is sent to be scheduled.

export const REASK_GAP = 4;

// A copy of `queue` with `entry` re-inserted REASK_GAP items after
// `position` (or at the end, if that's sooner).
export function reinsertLater<T>(queue: T[], position: number, entry: T, gap = REASK_GAP): T[] {
  const at = Math.min(queue.length, position + 1 + gap);
  return [...queue.slice(0, at), entry, ...queue.slice(at)];
}

export interface SessionAnswer {
  key: string;
  firstTry: boolean;
  correct: boolean;
  confidence: Confidence | null;
}

export interface SessionSummary {
  reviewed: number;
  firstTryCorrect: number;
  relearned: number;
  calibration: CalibrationSummary;
}

export function summarizeSession(answers: SessionAnswer[]): SessionSummary {
  const first = answers.filter((a) => a.firstTry);
  return {
    reviewed: first.length,
    firstTryCorrect: first.filter((a) => a.correct).length,
    relearned: first.filter((a) => !a.correct).length,
    calibration: summarizeCalibration(first),
  };
}

// The learner's local midnight, for the server's "new cards per day".
export function localDayStart(now = new Date()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}
