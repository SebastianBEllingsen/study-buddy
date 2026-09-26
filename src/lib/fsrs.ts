import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { FlashcardResult } from "./models";
import { DEFAULT_RETENTION, MAX_RETENTION, MIN_RETENTION, type Confidence } from "./review/types";

// FSRS (Free Spaced Repetition Scheduler, via ts-fsrs) for every card and
// quiz question the learner reviews — replaces the old SM-2 schedule in
// spacedRepetition.ts. Whole-day granularity: short-term (sub-day learning
// step) scheduling is off, and an item answered wrong is simply asked again
// later in the same session until it's right — only its first answer of
// the session is graded here.

export { Rating, State };

export { DEFAULT_RETENTION, MIN_RETENTION, MAX_RETENTION };

// An item due "in N days" becomes due a few hours before the same time of
// day N days on, so a daily study habit at a slightly earlier hour still
// finds yesterday's cards due — without depending on the user's timezone.
const DUE_SLACK_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// One review_items row's memory state (the columns this module owns).
export interface MemoryState {
  due_at: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  scheduled_days: number;
  last_reviewed_at: string | null;
}

export interface ReviewOutcome {
  memory: MemoryState;
  log: { rating: Grade; stability: number; difficulty: number; scheduled_days: number };
}

export function toUtcText(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function fromUtcText(text: string): Date {
  return new Date(`${text.replace(" ", "T")}Z`);
}

export function clampRetention(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_RETENTION;
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, n));
}

function scheduler(retention: number, fuzz: boolean) {
  return fsrs(
    generatorParameters({ request_retention: clampRetention(retention), enable_fuzz: fuzz, enable_short_term: false })
  );
}

function toCard(memory: MemoryState | null, now: Date): Card {
  if (!memory || memory.state === State.New) return createEmptyCard(now);
  return {
    due: fromUtcText(memory.due_at),
    stability: memory.stability,
    difficulty: memory.difficulty,
    elapsed_days: 0,
    scheduled_days: memory.scheduled_days,
    reps: memory.reps,
    lapses: memory.lapses,
    learning_steps: 0,
    state: memory.state as State,
    last_review: memory.last_reviewed_at ? fromUtcText(memory.last_reviewed_at) : undefined,
  };
}

// The item's next memory state after being graded `rating` at `now`.
export function scheduleReview(
  memory: MemoryState | null,
  rating: Grade,
  now = new Date(),
  options: { retention?: number; fuzz?: boolean } = {}
): ReviewOutcome {
  const { card } = scheduler(options.retention ?? DEFAULT_RETENTION, options.fuzz ?? true).next(
    toCard(memory, now),
    now,
    rating
  );
  const days = Math.max(1, card.scheduled_days);
  return {
    memory: {
      due_at: toUtcText(new Date(now.getTime() + days * DAY_MS - DUE_SLACK_MS)),
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      scheduled_days: days,
      last_reviewed_at: toUtcText(now),
    },
    log: { rating, stability: card.stability, difficulty: card.difficulty, scheduled_days: days },
  };
}

// The chance (0–1) the learner would recall the item right now. Never
// reviewed == 0: nothing has been learned yet.
export function retrievability(memory: MemoryState | null, now = new Date()): number {
  if (!memory || memory.state === State.New || !memory.last_reviewed_at) return 0;
  const r = scheduler(DEFAULT_RETENTION, false).get_retrievability(toCard(memory, now), now, false);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}

export function isDue(memory: { due_at: string } | null, now = new Date()): boolean {
  return !memory || memory.due_at <= toUtcText(now);
}

// A flashcard's self-rating maps straight onto FSRS's four grades.
export function ratingFromFlashcardResult(result: FlashcardResult): Grade {
  switch (result) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
  }
}

export type AnswerVerdict = "correct" | "partial" | "incorrect";

// A quiz answer is graded by the app, not the learner, so the confidence
// they tapped beforehand decides how well it was known: right but unsure
// (or a guess) is a shaky recall, scheduled sooner than a confident one.
export function ratingFromAnswer(verdict: AnswerVerdict, confidence: Confidence | null): Grade {
  if (verdict === "incorrect") return Rating.Again;
  if (verdict === "partial") return Rating.Hard;
  return confidence === "guess" || confidence === "unsure" ? Rating.Hard : Rating.Good;
}
