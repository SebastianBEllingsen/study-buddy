import { describe, expect, it, vi } from "vitest";

vi.mock("./queue", () => ({ DEFAULT_QUEUE_LIMIT: 100 }));
const { parseQueueParams } = await import("./queueParams");

const NOW = new Date("2026-03-02T10:00:00Z");
const url = (q: string) => new URL(`http://localhost/api/review/queue${q}`);

describe("parseQueueParams", () => {
  it("defaults to every course, UTC day and the default limit", () => {
    expect(parseQueueParams(url(""), NOW)).toEqual({ courseId: null, dayStart: undefined, limit: 100, mode: "due", concept: null });
  });

  it("reads a course, the learner's local midnight and a capped limit", () => {
    expect(parseQueueParams(url("?courseId=7&dayStart=2026-03-01T23:00:00.000Z&limit=9999"), NOW)).toEqual({
      courseId: 7,
      dayStart: "2026-03-01 23:00:00",
      limit: 500,
      mode: "due",
      concept: null,
    });
  });

  it("ignores malformed values and day starts that can't be today", () => {
    expect(parseQueueParams(url("?courseId=abc&dayStart=nonsense&limit=-3"), NOW)).toEqual({
      courseId: null,
      dayStart: undefined,
      limit: 100,
      mode: "due",
      concept: null,
    });
    expect(parseQueueParams(url("?dayStart=2026-03-03T00:00:00Z"), NOW).dayStart).toBeUndefined();
    expect(parseQueueParams(url("?dayStart=2026-02-20T00:00:00Z"), NOW).dayStart).toBeUndefined();
  });

  it("reads the focus modes, needing a concept name for concept mode", () => {
    expect(parseQueueParams(url("?mode=mistakes"), NOW).mode).toBe("mistakes");
    expect(parseQueueParams(url("?mode=concept&concept=%20Graphs%20"), NOW)).toMatchObject({ mode: "concept", concept: "Graphs" });
    expect(parseQueueParams(url("?mode=concept"), NOW).mode).toBe("due");
    expect(parseQueueParams(url("?mode=other"), NOW).mode).toBe("due");
  });
});
