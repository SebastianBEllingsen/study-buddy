import { describe, it, expect } from "vitest";
import { distributeCount } from "./quiz";

describe("distributeCount", () => {
  it("splits evenly when total divides parts exactly", () => {
    expect(distributeCount(12, 3)).toEqual([4, 4, 4]);
    expect(distributeCount(12, 2)).toEqual([6, 6]);
  });

  it("gives the remainder to the earliest parts", () => {
    expect(distributeCount(13, 3)).toEqual([5, 4, 4]);
    expect(distributeCount(14, 3)).toEqual([5, 5, 4]);
  });

  it("puts everything in the one part when parts is 1", () => {
    expect(distributeCount(12, 1)).toEqual([12]);
  });

  it("returns an array of the requested length that sums back to total", () => {
    const result = distributeCount(10, 4);
    expect(result).toHaveLength(4);
    expect(result.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("handles a total smaller than the number of parts (some parts get 0)", () => {
    expect(distributeCount(2, 5)).toEqual([1, 1, 0, 0, 0]);
  });
});
