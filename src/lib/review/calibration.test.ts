import { describe, expect, it } from "vitest";
import { calibrationMessage, summarizeCalibration } from "./calibration";

describe("summarizeCalibration", () => {
  it("counts confident misses and doubted hits, ignoring unrated answers", () => {
    const summary = summarizeCalibration([
      { confidence: "sure", correct: false },
      { confidence: "sure", correct: true },
      { confidence: "guess", correct: true },
      { confidence: "unsure", correct: false },
      { confidence: null, correct: false },
    ]);
    expect(summary).toEqual({ rated: 4, sureWrong: 1, doubtedRight: 1 });
  });
});

describe("calibrationMessage", () => {
  it("says nothing without ratings and names the blind spots otherwise", () => {
    expect(calibrationMessage({ rated: 0, sureWrong: 0, doubtedRight: 0 })).toBeNull();
    expect(calibrationMessage({ rated: 3, sureWrong: 0, doubtedRight: 0 })).toBe("Your confidence matched your answers.");
    expect(calibrationMessage({ rated: 5, sureWrong: 2, doubtedRight: 1 })).toBe(
      "2 answers you were sure of were wrong — they're in your mistake log; 1 you doubted was right."
    );
    expect(calibrationMessage({ rated: 2, sureWrong: 0, doubtedRight: 2 })).toBe("2 you doubted were right.");
  });
});
