// Grading runs in the background after hand-in (see gradeAttempt). An
// attempt's grading_started_at says when the current run began, so any
// computer using the same database can tell a run still in progress —
// here or on another computer — from one cut off by a restart, which is
// reported as failed so it can be retried.

import { toUtcText } from "../time";

// Longer than any real grading run takes.
export const STUCK_GRADING_MS = 15 * 60 * 1000;

export const INTERRUPTED_MESSAGE = "Grading was interrupted before it finished. Try again.";

declare global {
  var __studyBuddyGrading: Set<number> | undefined;
}

// Runs in this server process — always live, however long they take.
const running = (globalThis.__studyBuddyGrading ??= new Set<number>());

export function markGrading(attemptId: number): void {
  running.add(attemptId);
}

export function releaseGrading(attemptId: number): void {
  running.delete(attemptId);
}

// UTC "YYYY-MM-DD HH:MM:SS" of the moment before which a run counts as cut off.
export function stuckBefore(now = new Date()): string {
  return toUtcText(new Date(now.getTime() - STUCK_GRADING_MS));
}

// The status to show: "grading" only while a run is plausibly still going.
export function liveStatus<S extends string>(
  attempt: { id: number; status: S; grading_started_at: string | null },
  now = new Date()
): S | "failed" {
  if (attempt.status !== "grading" || running.has(attempt.id)) return attempt.status;
  return attempt.grading_started_at && attempt.grading_started_at >= stuckBefore(now) ? attempt.status : "failed";
}
