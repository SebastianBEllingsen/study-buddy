// The exam clock: time left in an attempt, not counting paused time.
// Client-safe.

function parseUtc(text: string): number {
  return Date.parse(`${text.replace(" ", "T")}Z`);
}

export function examTimeLeftMs(
  attempt: { started_at: string; paused_at: string | null; paused_seconds: number },
  durationMinutes: number,
  now: number
): number {
  const end = parseUtc(attempt.started_at) + durationMinutes * 60_000 + attempt.paused_seconds * 1000;
  // While paused the clock stands still at the moment it was paused.
  const at = attempt.paused_at ? parseUtc(attempt.paused_at) : now;
  return end - at;
}
