import { describe, expect, it } from "vitest";
import { examTimeLeftMs } from "./timing";

const start = "2026-03-02 10:00:00";
const at = (hhmm: string) => Date.parse(`2026-03-02T${hhmm}:00Z`);

describe("examTimeLeftMs", () => {
  it("counts down from the start, adds earlier pauses and stands still while paused", () => {
    expect(examTimeLeftMs({ started_at: start, paused_at: null, paused_seconds: 0 }, 60, at("10:45"))).toBe(15 * 60_000);
    expect(examTimeLeftMs({ started_at: start, paused_at: null, paused_seconds: 600 }, 60, at("10:45"))).toBe(25 * 60_000);
    const paused = { started_at: start, paused_at: "2026-03-02 10:30:00", paused_seconds: 0 };
    expect(examTimeLeftMs(paused, 60, at("12:00"))).toBe(30 * 60_000);
    expect(examTimeLeftMs({ started_at: start, paused_at: null, paused_seconds: 0 }, 60, at("11:10"))).toBe(-10 * 60_000);
  });
});
