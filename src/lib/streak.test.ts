import { describe, it, expect } from "vitest";
import { computeStreak } from "./streak";

const TODAY = new Date("2026-01-10T15:00:00.000Z"); // 2026-01-10, UTC

describe("computeStreak", () => {
  it("returns 0 when there's no study history at all", () => {
    expect(computeStreak([], TODAY)).toBe(0);
  });

  it("counts today when today is already in the history", () => {
    expect(computeStreak(["2026-01-10"], TODAY)).toBe(1);
  });

  it("counts a consecutive run ending today", () => {
    const dates = ["2026-01-08", "2026-01-09", "2026-01-10"];
    expect(computeStreak(dates, TODAY)).toBe(3);
  });

  it("stops at the first gap", () => {
    const dates = ["2026-01-05", "2026-01-09", "2026-01-10"];
    expect(computeStreak(dates, TODAY)).toBe(2);
  });

  it("grace period: hasn't studied today yet, but studied yesterday — streak still counts from yesterday", () => {
    const dates = ["2026-01-08", "2026-01-09"]; // no 2026-01-10 entry
    expect(computeStreak(dates, TODAY)).toBe(2);
  });

  it("grace period does not resurrect a streak broken before yesterday", () => {
    const dates = ["2026-01-07", "2026-01-08"]; // gap at 01-09, nothing today
    expect(computeStreak(dates, TODAY)).toBe(0);
  });

  it("is unaffected by unrelated dates in the future", () => {
    const dates = ["2026-01-10", "2026-01-15"];
    expect(computeStreak(dates, TODAY)).toBe(1);
  });

  it("is order-independent (dates need not be sorted)", () => {
    const dates = ["2026-01-10", "2026-01-08", "2026-01-09"];
    expect(computeStreak(dates, TODAY)).toBe(3);
  });
});
