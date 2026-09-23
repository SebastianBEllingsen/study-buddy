import type { FlashcardResult } from "./models";
import type { FlashcardsContent } from "./types";

export interface ScheduleState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export const DEFAULT_SCHEDULE: ScheduleState = {
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
};

const MIN_EASE = 1.3;

/**
 * Simplified SM-2 (the same family Anki's default algorithm descends from).
 * Interval granularity is whole days — enough for a study app, no need for
 * Anki's sub-day "learning steps".
 */
export function computeNextSchedule(
  current: ScheduleState,
  result: FlashcardResult
): ScheduleState {
  const { easeFactor, intervalDays, repetitions } = current;

  switch (result) {
    case "again":
      return { easeFactor: Math.max(MIN_EASE, easeFactor - 0.2), intervalDays: 0, repetitions: 0 };
    case "hard":
      return {
        easeFactor: Math.max(MIN_EASE, easeFactor - 0.15),
        intervalDays: Math.max(1, intervalDays * 1.2),
        repetitions: repetitions + 1,
      };
    case "good":
      return {
        easeFactor,
        intervalDays: repetitions === 0 ? 1 : repetitions === 1 ? 3 : intervalDays * easeFactor,
        repetitions: repetitions + 1,
      };
    case "easy":
      return {
        easeFactor: easeFactor + 0.15,
        intervalDays: repetitions === 0 ? 3 : intervalDays * easeFactor * 1.3,
        repetitions: repetitions + 1,
      };
  }
}

export function dueAtFromInterval(intervalDays: number): string {
  const due = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
  return due.toISOString().slice(0, 19).replace("T", " ");
}

// Cards with no schedule row (never reviewed) or a due_at in the past are
// due now. Both due_at (produced by dueAtFromInterval above) and SQLite's
// datetime('now') produce the same "YYYY-MM-DD HH:MM:SS" UTC format, so
// plain string comparison works the same way created_at ordering already
// does elsewhere in this app.
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
  return computeDueCardIndices(schedule, content.cards.length, now);
}
