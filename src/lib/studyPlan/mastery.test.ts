import { describe, expect, it } from "vitest";
import { computeChapterMastery, masteryLevel } from "./mastery";

const NOW = new Date("2026-03-01T12:00:00Z");

describe("computeChapterMastery", () => {
  it("is null with no results", () => {
    expect(computeChapterMastery({ quizScores: [], flashcardResults: [] }, NOW)).toBeNull();
  });

  it("averages quiz scores and card results, quizzes weighing more", () => {
    expect(computeChapterMastery({ quizScores: [{ score: 80, at: "2026-03-01 12:00:00" }], flashcardResults: [] }, NOW)).toBeCloseTo(0.8);
    const mixed = computeChapterMastery(
      {
        quizScores: [{ score: 100, at: "2026-03-01 12:00:00" }],
        flashcardResults: [{ result: "again", at: "2026-03-01 12:00:00" }],
      },
      NOW
    );
    // 5×1 + 1×0 over 6
    expect(mixed).toBeCloseTo(5 / 6);
  });

  it("lets recent results outweigh old ones", () => {
    const mastery = computeChapterMastery(
      {
        quizScores: [
          { score: 0, at: "2026-01-01 12:00:00" }, // ~59 days old → ~0.05 weight
          { score: 100, at: "2026-03-01 12:00:00" },
        ],
        flashcardResults: [],
      },
      NOW
    );
    expect(mastery).toBeGreaterThan(0.9);
  });
});

describe("masteryLevel", () => {
  it("buckets the score", () => {
    expect(masteryLevel(null)).toBe("none");
    expect(masteryLevel(0.3)).toBe("weak");
    expect(masteryLevel(0.6)).toBe("fair");
    expect(masteryLevel(0.85)).toBe("strong");
  });
});
