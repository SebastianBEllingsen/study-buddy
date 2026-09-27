// The single UTC "YYYY-MM-DD HH:MM:SS" timestamp format used everywhere in
// this app (due_at comparisons, streak dates, created_at/updated_at, ...).
// Generated here in the application layer rather than via a DB-side default
// like SQLite's datetime('now') — Postgres's equivalent, now(), returns a
// different representation, and generating it in JS keeps every timestamp
// column plain TEXT with identical string-comparison semantics on both
// backends (see spacedRepetition.ts's computeDueCardIndices and streak.ts).
export function nowUtc(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
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
