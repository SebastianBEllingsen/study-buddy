import { describe, expect, it } from "vitest";
import { parseChapterIds } from "./chapterIds";

describe("parseChapterIds", () => {
  it("reads a comma-separated list of ids, once each", () => {
    expect(parseChapterIds("3,1,3,2")).toEqual([3, 1, 2]);
  });

  it("drops anything that isn't a positive id", () => {
    expect(parseChapterIds("a,-1,0,2.5,,7")).toEqual([7]);
    expect(parseChapterIds("")).toEqual([]);
    expect(parseChapterIds(null)).toEqual([]);
  });

  it("caps how many it takes", () => {
    const many = Array.from({ length: 50 }, (_, i) => i + 1).join(",");
    expect(parseChapterIds(many)).toHaveLength(20);
  });
});
