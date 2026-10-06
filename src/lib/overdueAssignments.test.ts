import { describe, it, expect } from "vitest";
import { isPastDue, keepUnlessCompletedAndPast } from "./overdueAssignments";

const now = new Date("2026-03-10T12:00:00Z");
const ev = (id: string, end: string) => ({ id, start: end, end, allDay: false });

describe("keepUnlessCompletedAndPast", () => {
  it("keeps a past-due event that hasn't been checked off", () => {
    expect(keepUnlessCompletedAndPast([ev("a", "2026-03-01T10:00:00Z")], new Set(), now)).toHaveLength(1);
  });

  it("drops a past-due event once it's checked off", () => {
    expect(keepUnlessCompletedAndPast([ev("a", "2026-03-01T10:00:00Z")], new Set(["a"]), now)).toHaveLength(0);
  });

  it("keeps a checked-off event that is still upcoming", () => {
    expect(keepUnlessCompletedAndPast([ev("a", "2026-03-20T10:00:00Z")], new Set(["a"]), now)).toHaveLength(1);
  });
});

describe("isPastDue", () => {
  it("treats an all-day deadline as due through the end of that day", () => {
    const today = { start: "2026-03-10", end: "2026-03-10", allDay: true };
    expect(isPastDue(today, new Date(2026, 2, 10, 15))).toBe(false);
    expect(isPastDue(today, new Date(2026, 2, 11, 0, 1))).toBe(true);
  });
});
