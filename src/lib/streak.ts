/**
 * Consecutive days of study activity, counting backward from today.
 * studyDates are "YYYY-MM-DD" strings (UTC, matching this app's other
 * datetime handling — see dueAtFromInterval in spacedRepetition.ts).
 *
 * If today isn't in studyDates yet, counting starts from yesterday instead
 * of returning 0 — the streak doesn't visually break until the UTC day is
 * fully over, the same grace period Anki/Duolingo-style streaks use.
 */
export function computeStreak(studyDates: string[], today = new Date()): number {
  const days = new Set(studyDates);
  const cursor = new Date(today);

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  if (!days.has(isoDate(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (days.has(isoDate(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
