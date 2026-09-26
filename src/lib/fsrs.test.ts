import { describe, expect, it } from "vitest";
import {
  clampRetention,
  fromUtcText,
  isDue,
  Rating,
  ratingFromAnswer,
  ratingFromFlashcardResult,
  retrievability,
  scheduleReview,
  State,
  toUtcText,
} from "./fsrs";

const NOW = new Date("2026-03-02T10:00:00Z");
const noFuzz = { fuzz: false };

describe("scheduleReview", () => {
  it("schedules a new item a whole number of days out, due a little before that time of day", () => {
    const { memory, log } = scheduleReview(null, Rating.Good, NOW, noFuzz);
    expect(memory.scheduled_days).toBeGreaterThanOrEqual(1);
    expect(memory.state).toBe(State.Review);
    expect(memory.reps).toBe(1);
    expect(memory.last_reviewed_at).toBe("2026-03-02 10:00:00");
    const dueMs = fromUtcText(memory.due_at).getTime();
    expect(dueMs).toBe(NOW.getTime() + memory.scheduled_days * 86_400_000 - 4 * 3_600_000);
    expect(log).toMatchObject({ rating: Rating.Good, scheduled_days: memory.scheduled_days });
  });

  it("orders intervals Again < Hard < Good < Easy for a new item", () => {
    const days = ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const).map(
      (r) => scheduleReview(null, r, NOW, noFuzz).memory.scheduled_days
    );
    expect(days[0]).toBe(1);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    expect(days[3]).toBeGreaterThan(days[0]);
  });

  it("grows the interval on repeated success and counts a lapse on failure", () => {
    const first = scheduleReview(null, Rating.Good, NOW, noFuzz).memory;
    const later = fromUtcText(first.due_at);
    const second = scheduleReview(first, Rating.Good, later, noFuzz).memory;
    expect(second.scheduled_days).toBeGreaterThan(first.scheduled_days);
    const failed = scheduleReview(second, Rating.Again, fromUtcText(second.due_at), noFuzz).memory;
    expect(failed.lapses).toBe(1);
    expect(failed.scheduled_days).toBeLessThan(second.scheduled_days);
  });

  it("schedules further out at a lower target retention", () => {
    const first = scheduleReview(null, Rating.Good, NOW, noFuzz).memory;
    const at = new Date(fromUtcText(first.due_at).getTime() + 86_400_000);
    const high = scheduleReview(first, Rating.Good, at, { fuzz: false, retention: 0.95 }).memory;
    const low = scheduleReview(first, Rating.Good, at, { fuzz: false, retention: 0.8 }).memory;
    expect(low.scheduled_days).toBeGreaterThan(high.scheduled_days);
  });
});

describe("retrievability", () => {
  it("is 0 for a never-reviewed item and falls over time after a review", () => {
    expect(retrievability(null, NOW)).toBe(0);
    const memory = scheduleReview(null, Rating.Good, NOW, noFuzz).memory;
    const soon = retrievability(memory, new Date(NOW.getTime() + 86_400_000));
    const late = retrievability(memory, new Date(NOW.getTime() + 30 * 86_400_000));
    expect(soon).toBeGreaterThan(late);
    expect(soon).toBeLessThanOrEqual(1);
    expect(late).toBeGreaterThan(0);
  });
});

describe("isDue", () => {
  it("treats a missing state as due and compares due_at to now", () => {
    expect(isDue(null, NOW)).toBe(true);
    expect(isDue({ due_at: "2026-03-02 09:59:59" }, NOW)).toBe(true);
    expect(isDue({ due_at: "2026-03-02 10:00:01" }, NOW)).toBe(false);
  });
});

describe("ratings", () => {
  it("maps flashcard self-ratings one to one", () => {
    expect(ratingFromFlashcardResult("again")).toBe(Rating.Again);
    expect(ratingFromFlashcardResult("hard")).toBe(Rating.Hard);
    expect(ratingFromFlashcardResult("good")).toBe(Rating.Good);
    expect(ratingFromFlashcardResult("easy")).toBe(Rating.Easy);
  });

  it("grades answers by verdict, marking unsure or guessed correct answers Hard", () => {
    expect(ratingFromAnswer("incorrect", "sure")).toBe(Rating.Again);
    expect(ratingFromAnswer("partial", "sure")).toBe(Rating.Hard);
    expect(ratingFromAnswer("correct", "sure")).toBe(Rating.Good);
    expect(ratingFromAnswer("correct", null)).toBe(Rating.Good);
    expect(ratingFromAnswer("correct", "unsure")).toBe(Rating.Hard);
    expect(ratingFromAnswer("correct", "guess")).toBe(Rating.Hard);
  });
});

describe("helpers", () => {
  it("clamps retention into the supported range", () => {
    expect(clampRetention(0.5)).toBe(0.8);
    expect(clampRetention(0.99)).toBe(0.97);
    expect(clampRetention(0.85)).toBe(0.85);
    expect(clampRetention("x")).toBe(0.9);
  });

  it("round-trips UTC text timestamps", () => {
    expect(toUtcText(fromUtcText("2026-03-02 10:00:00"))).toBe("2026-03-02 10:00:00");
  });
});
