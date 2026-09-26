import { describe, expect, it } from "vitest";
import { localDayStart, reinsertLater, summarizeSession } from "./session";

describe("reinsertLater", () => {
  it("puts a missed item a few places later, or at the end", () => {
    expect(reinsertLater(["a", "b", "c", "d", "e", "f", "g"], 1, "x", 2)).toEqual(["a", "b", "c", "d", "x", "e", "f", "g"]);
    expect(reinsertLater(["a", "b"], 1, "x", 4)).toEqual(["a", "b", "x"]);
  });
});

describe("summarizeSession", () => {
  it("counts only first answers", () => {
    const summary = summarizeSession([
      { key: "1", firstTry: true, correct: false, confidence: "sure" },
      { key: "2", firstTry: true, correct: true, confidence: null },
      { key: "1", firstTry: false, correct: true, confidence: null },
    ]);
    expect(summary).toEqual({
      reviewed: 2,
      firstTryCorrect: 1,
      relearned: 1,
      calibration: { rated: 1, sureWrong: 1, doubtedRight: 0 },
    });
  });
});

describe("localDayStart", () => {
  it("is local midnight of the given day", () => {
    const start = new Date(localDayStart(new Date(2026, 2, 2, 15, 30)));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([
      2026, 2, 2, 0, 0,
    ]);
  });
});
