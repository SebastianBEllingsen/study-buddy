import type { FlashcardsContent } from "./types";

// Due-ness of a deck's cards from their review state (review_items rows,
// scheduled by FSRS in lib/fsrs.ts). Cards with no row (never reviewed) or a
// due_at in the past are due now. due_at uses the app's "YYYY-MM-DD
// HH:MM:SS" UTC format (lib/time.ts), so plain string comparison works the
// same way created_at ordering already does elsewhere in this app.
export function computeDueCardIndices(
  schedule: { card_index: number; due_at: string }[],
  cardCount: number,
  now = new Date()
): number[] {
  const nowStr = now.toISOString().slice(0, 19).replace("T", " ");
  const scheduleByIndex = new Map(schedule.map((s) => [s.card_index, s]));
  const due: number[] = [];
  for (let i = 0; i < cardCount; i++) {
    const entry = scheduleByIndex.get(i);
    if (!entry || entry.due_at <= nowStr) due.push(i);
  }
  return due;
}

// A deck with reminders turned off never has anything due, whatever its
// schedule says — every due count (item page, course page, dashboard) goes
// through here rather than computeDueCardIndices directly.
export function deckDueCardIndices(
  schedule: { card_index: number; due_at: string }[],
  content: FlashcardsContent,
  now = new Date()
): number[] {
  if (content.reminders === false) return [];
  // Flagged cards are held out of review until the flag is resolved.
  return computeDueCardIndices(schedule, content.cards.length, now).filter((i) => !content.cards[i]?.flag);
}
