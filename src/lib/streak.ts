/**
 * Consecutive days of study activity, counting backward from today.
 * studyDates are local calendar days ("YYYY-MM-DD", see listStudyActivity),
 * so a session after midnight counts for the day it happened on.
 *
 * If today isn't in studyDates yet, counting starts from yesterday instead
 * of returning 0 — the streak doesn't visually break until the day is
 * fully over, the same grace period Anki/Duolingo-style streaks use.
 */
export function computeStreak(studyDates: string[], today = new Date()): number {
  const days = new Set(studyDates);
  // Date-only arithmetic on the local calendar day, done in UTC so no
  // timezone shift can move it.
  const cursor = new Date(`${localDay(today)}T00:00:00Z`);
  const key = () => cursor.toISOString().slice(0, 10);

  if (!days.has(key())) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (days.has(key())) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
