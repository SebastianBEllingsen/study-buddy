import { describe, it, expect } from "vitest";
import { parseOrderedIds } from "./reorderRequest";

describe("parseOrderedIds", () => {
  it("accepts an array of integers", () => {
    expect(parseOrderedIds([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("accepts an empty array", () => {
    expect(parseOrderedIds([])).toEqual([]);
  });

  it("rejects a non-array", () => {
    expect(parseOrderedIds("not-an-array")).toBeNull();
    expect(parseOrderedIds(undefined)).toBeNull();
    expect(parseOrderedIds(null)).toBeNull();
    expect(parseOrderedIds({ 0: 1, 1: 2 })).toBeNull();
  });

  it("rejects an array containing a non-integer", () => {
    expect(parseOrderedIds([1, 2.5, 3])).toBeNull();
    expect(parseOrderedIds([1, "2", 3])).toBeNull();
    expect(parseOrderedIds([1, null, 3])).toBeNull();
    expect(parseOrderedIds([1, NaN, 3])).toBeNull();
  });
});
