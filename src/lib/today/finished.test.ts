import { describe, it, expect, vi } from "vitest";
import type { TestDb } from "../db/testHarness";

// "../db" points at a throwaway in-memory SQLite database bootstrapped with
// the production schema (same setup as studyPlan/store.test.ts).
let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const { getDayTotals, parseFinishedDate, parseFinishedSession, recordFinishedToday } = await import("./finished");

describe("parseFinishedSession", () => {
  it("accepts a day with step and focus counts", () => {
    expect(parseFinishedSession({ date: "2026-10-06", steps: 3, focusMs: 600_000 })).toEqual({
      date: "2026-10-06",
      steps: 3,
      focusMs: 600_000,
    });
  });

  it("rejects bad dates and counts", () => {
    for (const body of [
      {},
      { date: "10/06/2026", steps: 1, focusMs: 1 },
      { date: "2026-10-06", steps: -1, focusMs: 1 },
      { date: "2026-10-06", steps: 1, focusMs: "5" },
      { date: "2026-10-06", steps: 1, focusMs: Infinity },
    ]) {
      expect(parseFinishedSession(body)).toBeNull();
    }
  });

  it("caps an implausible focus time", () => {
    expect(parseFinishedSession({ date: "2026-10-06", steps: 1, focusMs: 1e12 })?.focusMs).toBe(86_400_000);
  });
});

describe("parseFinishedDate", () => {
  it("only takes YYYY-MM-DD", () => {
    expect(parseFinishedDate("2026-10-06")).toBe("2026-10-06");
    expect(parseFinishedDate("2026-10-06T00:00")).toBeNull();
    expect(parseFinishedDate(null)).toBeNull();
  });
});

describe("day totals", () => {
  it("is null for a day with nothing finished", async () => {
    expect(await getDayTotals("2026-01-01")).toBeNull();
  });

  it("adds up a day's finished sessions and keeps days apart", async () => {
    await recordFinishedToday({ date: "2026-10-06", steps: 2, focusMs: 600_000 });
    await recordFinishedToday({ date: "2026-10-06", steps: 1, focusMs: 300_000 });
    await recordFinishedToday({ date: "2026-10-05", steps: 4, focusMs: 1000 });
    expect(await getDayTotals("2026-10-06")).toEqual({ date: "2026-10-06", sessions: 2, steps: 3, focusMs: 900_000 });
    expect(await getDayTotals("2026-10-05")).toMatchObject({ sessions: 1, steps: 4 });
  });
});
