import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in the same order as the input, regardless of completion order", async () => {
    const items = [30, 10, 20, 5];
    const result = await mapWithConcurrency(items, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual(items);
  });

  it("runs exactly `limit` calls at once, not fewer", async () => {
    // toBe, not toBeLessThanOrEqual — a strictly-sequential implementation
    // (maxActive always 1) or one that ignores `limit` and never actually
    // parallelizes would both pass a "<=" check; with 10 items and a fixed
    // per-item delay, 3 concurrent workers should all be mid-flight at once.
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return i;
    });

    expect(maxActive).toBe(3);
  });

  it("propagates a rejection from any item", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (i) => {
        if (i === 2) throw new Error("boom");
        return i;
      })
    ).rejects.toThrow("boom");
  });

  it("handles an empty input array", async () => {
    const result = await mapWithConcurrency([], 3, async (i) => i);
    expect(result).toEqual([]);
  });

  it("handles a limit larger than the input length", async () => {
    const result = await mapWithConcurrency([1, 2], 10, async (i) => i * 2);
    expect(result).toEqual([2, 4]);
  });

  // Regression coverage: `Math.min(limit, items.length)` with a limit of 0
  // (or negative) spawns zero workers, silently resolving to an array of
  // holes with fn() never called on anything, rather than erroring or
  // falling back to real concurrency.
  it("still processes every item when limit is 0, falling back to sequential", async () => {
    const result = await mapWithConcurrency([1, 2, 3], 0, async (i) => i * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it("still processes every item when limit is negative", async () => {
    const result = await mapWithConcurrency([1, 2, 3], -5, async (i) => i * 2);
    expect(result).toEqual([2, 4, 6]);
  });
});
