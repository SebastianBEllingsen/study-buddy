import { describe, expect, it } from "vitest";
import { examMode } from "./examMode";

describe("examMode", () => {
  it("is off without an exam date, after it, or more than three weeks out", () => {
    expect(examMode(null, null, true).active).toBe(false);
    expect(examMode(-1, null, true).active).toBe(false);
    expect(examMode(30, null, true).active).toBe(false);
  });

  it("stops new material in the last three days", () => {
    expect(examMode(10, 0, true).noNewMaterial).toBe(false);
    expect(examMode(3, 0, true).noNewMaterial).toBe(true);
  });

  it("asks for a mock exam at about 14, 7 and 3 days out unless one was just taken", () => {
    expect(examMode(14, null, true).mockExamDue).toBe(true);
    expect(examMode(12, 5, true).mockExamDue).toBe(true);
    expect(examMode(12, 1, true).mockExamDue).toBe(false);
    expect(examMode(7, 3, true).mockExamDue).toBe(true);
    expect(examMode(3, 0, true).mockExamDue).toBe(false);
    expect(examMode(3, 2, true).mockExamDue).toBe(true);
    expect(examMode(2, 2, true).mockExamDue).toBe(true);
    expect(examMode(5, 1, true).mockExamDue).toBe(false);
    expect(examMode(0, null, true).mockExamDue).toBe(false);
    expect(examMode(18, null, true).mockExamDue).toBe(false);
    expect(examMode(14, null, false).mockExamDue).toBe(false);
  });
});
