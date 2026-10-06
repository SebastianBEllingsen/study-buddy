// The single UTC "YYYY-MM-DD HH:MM:SS" timestamp format used everywhere in
// this app (due_at comparisons, streak dates, created_at/updated_at, ...).
// Application code generates it here rather than relying on a database
// clock — Postgres's now() has a different representation from SQLite's
// datetime('now') — so every timestamp column is plain TEXT with identical
// string-comparison semantics on both backends (see dueCards.ts's
// computeDueCardIndices and streak.ts). The schema's own datetime('now')
// defaults produce this same format and only cover rows written outside the app.
export function nowUtc(): string {
  return toUtcText(new Date());
}

// A moment as that same UTC text — the one place that formats it.
export function toUtcText(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// ...and back to a Date.
export function fromUtcText(text: string): Date {
  return new Date(`${text.replace(" ", "T")}Z`);
}

// The local calendar day ("YYYY-MM-DD") a stored UTC timestamp falls on —
// for grouping activity by the day it happened for the learner (streak,
// heatmap), not by UTC day. Runs on the server, which in this local app is
// the learner's own machine and timezone.
export function localDayOfUtc(text: string): string {
  const d = new Date(`${text.replace(" ", "T")}Z`);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
