import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeNextSchedule, dueAtFromInterval, computeDueCardIndices, DEFAULT_SCHEDULE } from "./spacedRepetition";

describe("computeNextSchedule", () => {
  it("'again' resets interval/repetitions and lowers ease, floored at 1.3", () => {
    const result = computeNextSchedule({ easeFactor: 1.4, intervalDays: 10, repetitions: 3 }, "again");
    expect(result).toEqual({ easeFactor: 1.3, intervalDays: 0, repetitions: 0 });
  });

  it("'again' never drops ease below the 1.3 floor even from a low starting point", () => {
    const result = computeNextSchedule({ easeFactor: 1.3, intervalDays: 5, repetitions: 2 }, "again");
    expect(result.easeFactor).toBe(1.3);
  });

  it("'hard' grows the interval by 1.2x (min 1 day) and lowers ease slightly", () => {
    const result = computeNextSchedule({ easeFactor: 2.5, intervalDays: 10, repetitions: 2 }, "hard");
    expect(result).toEqual({ easeFactor: 2.35, intervalDays: 12, repetitions: 3 });
  });

  it("'hard' floors a near-zero interval at 1 day", () => {
    const result = computeNextSchedule({ easeFactor: 2.5, intervalDays: 0, repetitions: 0 }, "hard");
    expect(result.intervalDays).toBe(1);
  });

  it("'good' on a brand-new card (0 repetitions) sets interval to 1 day", () => {
    const result = computeNextSchedule(DEFAULT_SCHEDULE, "good");
    expect(result).toEqual({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 });
  });

  it("'good' on the second repetition sets interval to 3 days", () => {
    const result = computeNextSchedule({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 }, "good");
    expect(result).toEqual({ easeFactor: 2.5, intervalDays: 3, repetitions: 2 });
  });

  it("'good' on later repetitions multiplies interval by ease factor", () => {
    const result = computeNextSchedule({ easeFactor: 2.0, intervalDays: 3, repetitions: 2 }, "good");
    expect(result).toEqual({ easeFactor: 2.0, intervalDays: 6, repetitions: 3 });
  });

  it("'easy' on a brand-new card sets interval to 3 days and boosts ease", () => {
    const result = computeNextSchedule(DEFAULT_SCHEDULE, "easy");
    expect(result).toEqual({ easeFactor: 2.65, intervalDays: 3, repetitions: 1 });
  });

  it("'easy' on later repetitions multiplies interval by ease * 1.3", () => {
    const result = computeNextSchedule({ easeFactor: 2.0, intervalDays: 3, repetitions: 2 }, "easy");
    expect(result.repetitions).toBe(3);
    expect(result.easeFactor).toBeCloseTo(2.15);
    expect(result.intervalDays).toBeCloseTo(3 * 2.0 * 1.3);
  });
});

describe("dueAtFromInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds whole days to the current time in the app's UTC string format", () => {
    expect(dueAtFromInterval(1)).toBe("2026-01-02 00:00:00");
  });

  it("handles a fractional interval that lands exactly on a whole-second boundary", () => {
    expect(dueAtFromInterval(1.5)).toBe("2026-01-02 12:00:00");
  });

  // Regression coverage: 1.5 days above lands on an exact whole-second
  // boundary (no rounding actually exercised — 1.5 days is precisely
  // 12:00:00.000). toISOString().slice(0, 19) *truncates* sub-second
  // precision (a plain string cut, not Math.round), so a fractional
  // interval landing mid-second must floor down to the second before it,
  // not round to the nearest one — 1600ms past a boundary would round up to
  // +2s but truncates down to +1s.
  it("truncates (does not round) a fractional interval that lands mid-second", () => {
    const intervalDays = 1 + 1600 / (24 * 60 * 60 * 1000); // 1 day + 1.6s
    expect(dueAtFromInterval(intervalDays)).toBe("2026-01-02 00:00:01");
  });

  it("handles a zero interval (due immediately)", () => {
    expect(dueAtFromInterval(0)).toBe("2026-01-01 00:00:00");
  });
});

describe("computeDueCardIndices", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");

  it("treats a card with no schedule row as due", () => {
    expect(computeDueCardIndices([], 3, now)).toEqual([0, 1, 2]);
  });

  it("treats a card whose due_at is in the past as due", () => {
    const schedule = [{ card_index: 0, due_at: "2026-01-01 00:00:00" }];
    expect(computeDueCardIndices(schedule, 1, now)).toEqual([0]);
  });

  it("treats a card whose due_at is exactly now as due (inclusive)", () => {
    const schedule = [{ card_index: 0, due_at: "2026-01-10 00:00:00" }];
    expect(computeDueCardIndices(schedule, 1, now)).toEqual([0]);
  });

  it("excludes a card whose due_at is in the future", () => {
    const schedule = [{ card_index: 0, due_at: "2026-02-01 00:00:00" }];
    expect(computeDueCardIndices(schedule, 1, now)).toEqual([]);
  });

  it("mixes due and not-due cards correctly", () => {
    const schedule = [
      { card_index: 0, due_at: "2026-01-01 00:00:00" }, // due
      { card_index: 1, due_at: "2026-02-01 00:00:00" }, // not due
      // card_index 2 has no schedule row at all -> due
    ];
    expect(computeDueCardIndices(schedule, 3, now)).toEqual([0, 2]);
  });
});
