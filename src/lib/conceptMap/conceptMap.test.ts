import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));

const { createCourse, getCanvas } = await import("../models");
const { findOrCreateConcepts } = await import("../review/concepts");
const { buildConceptMap, collectMapGroups, normalizeLinks, ConceptMapError } = await import("./build");
const { layoutConceptMap, recallColor } = await import("./layout");
const { normalizeWhy } = await import("../prompts/why");

beforeEach(() => generateStructured.mockReset());

describe("layoutConceptMap", () => {
  it("puts concepts in chapter groups, colours by recall and routes edges by position", () => {
    const data = layoutConceptMap(
      [
        { label: "Ch 1", concepts: [{ id: "c1", name: "A", recall: 0.9 }, { id: "c2", name: "B", recall: null }] },
        { label: "Ch 2", concepts: [{ id: "c3", name: "C", recall: 0.1 }] },
      ],
      [
        { from: "c1", to: "c3", label: "leads to" },
        { from: "c3", to: "c1", label: "duplicate pair" },
        { from: "c1", to: "c2", label: "above" },
        { from: "c1", to: "c9", label: "unknown" },
      ]
    );
    expect(data.nodes.filter((n) => n.type === "group").map((n) => (n as { label?: string }).label)).toEqual(["Ch 1", "Ch 2"]);
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    expect(byId.get("c1")?.color).toBe("4");
    expect(byId.get("c2")?.color).toBeUndefined();
    expect(byId.get("c3")?.color).toBe("1");
    expect(byId.get("c3")!.x).toBeGreaterThan(byId.get("c1")!.x);
    expect(data.edges.map((e) => [e.fromNode, e.toNode, e.fromSide, e.toSide])).toEqual([
      ["c1", "c3", "right", "left"],
      ["c1", "c2", "bottom", "top"],
    ]);
  });

  it("maps recall to the palette", () => {
    expect([0.95, 0.7, 0.4, 0.1, null].map(recallColor)).toEqual(["4", "5", "3", "1", undefined]);
  });
});

describe("normalizeLinks", () => {
  it("keeps links between known, different concepts", () => {
    const ids = new Set(["c1", "c2"]);
    expect(normalizeLinks({ links: [{ from: "c1", to: "c2", label: " uses " }, { from: "c1", to: "c1" }, { from: "x", to: "c2" }] }, ids)).toEqual([
      { from: "c1", to: "c2", label: "uses" },
    ]);
    expect(normalizeLinks({}, ids)).toEqual([]);
  });
});

describe("buildConceptMap", () => {
  it("needs a few concepts, then saves a canvas", async () => {
    const course = await createCourse("Sample Course");
    await expect(buildConceptMap(course.id)).rejects.toBeInstanceOf(ConceptMapError);

    await findOrCreateConcepts(course.id, ["Sets", "Relations", "Functions"]);
    const groups = await collectMapGroups(course.id);
    expect(groups).toEqual([{ label: "Concepts", concepts: expect.arrayContaining([expect.objectContaining({ name: "Sets" })]) }]);
    const ids = groups[0].concepts.map((c) => c.id);
    generateStructured.mockResolvedValue({ links: [{ from: ids[0], to: ids[1], label: "underlie" }] });

    const { canvasId } = await buildConceptMap(course.id);
    const canvas = await getCanvas(canvasId);
    expect(canvas?.title).toBe("Concept map");
    expect(canvas?.data.nodes.filter((n) => n.type === "text")).toHaveLength(3);
    expect(canvas?.data.edges).toHaveLength(1);
  });
});

describe("normalizeWhy", () => {
  it("needs an explanation and drops a null-ish feedback", () => {
    expect(normalizeWhy({ feedback: "null", explanation: " Because. " })).toEqual({ feedback: null, explanation: "Because." });
    expect(normalizeWhy({ feedback: "Close.", explanation: "x" })).toEqual({ feedback: "Close.", explanation: "x" });
    expect(normalizeWhy({ feedback: "x" })).toBeNull();
  });
});
