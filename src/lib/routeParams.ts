// A dynamic route segment ([noteId], [courseId], …) that fails to parse as
// a real integer — a stray path segment, a stale bookmarked link, a scanner
// probing arbitrary paths — needs to resolve to the same 404 an out-of-
// range-but-numeric id gets. Without this, `Number(param)` produces NaN,
// and passing NaN straight into a Drizzle `eq()` query throws on the
// Postgres backend (postgres.js rejects it as a malformed parameter)
// instead of the SQLite backend's harmless "no rows matched" — the same
// route 404s locally and 500s once storage is pointed at Supabase.
export function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}
