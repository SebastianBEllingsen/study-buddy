import { describe, expect, it } from "vitest";
import { groupStages, resolveStages, roadmapLabel } from "./roadmap";

const ch = (id: number, position: number, stage: number) => ({ id, position, stage });

describe("roadmapLabel", () => {
  it("joins parallel chapters with + and stages with →", () => {
    expect(roadmapLabel([ch(10, 0, 1), ch(11, 1, 2), ch(12, 2, 2), ch(13, 3, 3)])).toBe("1 → 2 + 3 → 4");
  });

  it("numbers by position, not id, and tolerates gaps in stage numbers", () => {
    expect(roadmapLabel([ch(5, 1, 7), ch(9, 0, 3), ch(2, 2, 3)])).toBe("1 + 3 → 2");
  });

  it("is a single number for a single chapter, and empty for none", () => {
    expect(roadmapLabel([ch(1, 0, 1)])).toBe("1");
    expect(roadmapLabel([])).toBe("");
  });
});

describe("groupStages", () => {
  it("orders stages ascending and chapters within a stage by position", () => {
    const groups = groupStages([ch(1, 2, 2), ch(2, 0, 1), ch(3, 1, 2)]);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([[2], [3, 1]]);
  });
});

describe("resolveStages", () => {
  it("keeps valid AI stages, renumbered to 1..n", () => {
    expect(resolveStages([{ stage: 1, prerequisites: [] }, { stage: 3, prerequisites: [0] }])).toEqual([1, 2]);
  });

  it("moves a chapter after its prerequisites when the AI put it too early", () => {
    expect(
      resolveStages([
        { stage: 1, prerequisites: [] },
        { stage: 1, prerequisites: [0] },
        { stage: 1, prerequisites: [1] },
      ])
    ).toEqual([1, 2, 3]);
  });

  it("ignores self, forward, and out-of-range prerequisites", () => {
    expect(
      resolveStages([
        { stage: 1, prerequisites: [0, 1, 5, -1] },
        { stage: 1, prerequisites: [] },
      ])
    ).toEqual([1, 1]);
  });

  it("treats a missing or invalid stage as stage 1", () => {
    expect(resolveStages([{ stage: 0, prerequisites: [] }, { stage: Number.NaN, prerequisites: [] }])).toEqual([1, 1]);
  });
});
