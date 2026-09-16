import { describe, it, expect, vi, afterEach } from "vitest";
import { nowUtc } from "./time";

describe("nowUtc", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces the 'YYYY-MM-DD HH:MM:SS' format every other timestamp comparison in this app assumes", () => {
    expect(nowUtc()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("matches the current UTC time, truncated to whole seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T09:08:07.654Z"));
    expect(nowUtc()).toBe("2026-03-05 09:08:07");
  });
});
