import { describe, it, expect } from "vitest";
import {
  amendHistory,
  canvasReferences,
  canvasReferencesTarget,
  canvasFileName,
  canvasTitleFromFileName,
  parseCanvasFile,
  serializeCanvas,
  createHistory,
  duplicateSelection,
  facingSides,
  generateCanvasId,
  MAX_HISTORY,
  nearestSide,
  nodesInsideGroup,
  parseCanvasJson,
  parseFileRef,
  placeNodeAtDrop,
  pushHistory,
  redoHistory,
  sanitizeCanvasData,
  snapToGrid,
  undoHistory,
  type CanvasData,
} from "./canvas";

const text = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  text: "hi",
  x: 0,
  y: 0,
  width: 250,
  height: 60,
  ...extra,
});

describe("sanitizeCanvasData", () => {
  it("accepts a well-formed JSON Canvas document unchanged", () => {
    const data = {
      nodes: [
        text("a", { color: "1" }),
        { id: "b", type: "file", file: "note:3", subpath: "#intro", x: 10, y: 20, width: 400, height: 400 },
        { id: "c", type: "link", url: "https://example.com", x: 0, y: 0, width: 300, height: 200 },
        { id: "g", type: "group", label: "Power", x: -50, y: -50, width: 800, height: 600, color: "#ff0000" },
      ],
      edges: [
        { id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", toEnd: "arrow", label: "USB" },
      ],
    };
    expect(sanitizeCanvasData(data)).toEqual(data);
  });

  it("rejects values that aren't a canvas at all", () => {
    expect(sanitizeCanvasData(null)).toBeNull();
    expect(sanitizeCanvasData([])).toBeNull();
    expect(sanitizeCanvasData({ nodes: "nope" })).toBeNull();
  });

  it("treats missing nodes/edges arrays as empty", () => {
    expect(sanitizeCanvasData({})).toEqual({ nodes: [], edges: [] });
  });

  it("drops malformed nodes, unknown types, and duplicate ids instead of failing", () => {
    const result = sanitizeCanvasData({
      nodes: [
        text("a"),
        text("a"),
        { id: "x", type: "diagram", x: 0, y: 0, width: 10, height: 10 },
        { id: "y", type: "text", text: "no coords" },
        { id: "z", type: "file", x: 0, y: 0, width: 100, height: 100 },
      ],
      edges: [],
    });
    expect(result?.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("drops edges whose endpoints don't exist", () => {
    const result = sanitizeCanvasData({
      nodes: [text("a"), text("b")],
      edges: [
        { id: "ok", fromNode: "a", toNode: "b" },
        { id: "dangling", fromNode: "a", toNode: "gone" },
      ],
    });
    expect(result?.edges.map((e) => e.id)).toEqual(["ok"]);
  });

  it("strips invalid colors, sides and ends but keeps the edge", () => {
    const result = sanitizeCanvasData({
      nodes: [text("a", { color: "red" }), text("b")],
      edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "middle", toEnd: "diamond", color: "7" }],
    });
    expect(result?.nodes[0].color).toBeUndefined();
    expect(result?.edges[0]).toEqual({ id: "e", fromNode: "a", toNode: "b" });
  });

  it("clamps sizes to the minimum card size", () => {
    const result = sanitizeCanvasData({ nodes: [text("a", { width: 1, height: -5 })], edges: [] });
    expect(result?.nodes[0]).toMatchObject({ width: 80, height: 40 });
  });
});

describe("parseCanvasJson", () => {
  it("degrades corrupted JSON to an empty canvas", () => {
    expect(parseCanvasJson("{not json")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvasJson("42")).toEqual({ nodes: [], edges: [] });
  });
});

describe(".canvas files", () => {
  const data = sanitizeCanvasData({ nodes: [text("a")], edges: [] })!;

  it("round-trips through serialize/parse", () => {
    const file = serializeCanvas(data);
    expect(file).toContain('\t"nodes"');
    expect(parseCanvasFile(file)).toEqual(data);
  });

  it("rejects files that aren't canvases", () => {
    expect(parseCanvasFile("not json")).toBeNull();
    expect(parseCanvasFile("[1,2]")).toBeNull();
  });

  it("keeps an Obsidian vault file card instead of dropping it", () => {
    const parsed = parseCanvasFile(
      JSON.stringify({ nodes: [{ id: "f", type: "file", file: "Notes/Power.md", x: 0, y: 0, width: 400, height: 400 }] })
    );
    expect(parsed?.nodes[0]).toMatchObject({ type: "file", file: "Notes/Power.md" });
  });

  it("builds safe file names and titles", () => {
    expect(canvasFileName('Exam 1: CPU/GPU "overview"')).toBe("Exam 1 CPUGPU overview.canvas");
    expect(canvasFileName("  ")).toBe("Untitled canvas.canvas");
    expect(canvasTitleFromFileName("Laptop.canvas")).toBe("Laptop");
    expect(canvasTitleFromFileName(".canvas")).toBe("Imported canvas");
  });
});

describe("parseFileRef", () => {
  it("parses app references", () => {
    expect(parseFileRef("note:12")).toEqual({ type: "note", id: 12 });
    expect(parseFileRef("image:5")).toEqual({ type: "image", id: 5 });
  });

  it("rejects vault paths and malformed references", () => {
    expect(parseFileRef("Notes/foo.md")).toBeNull();
    expect(parseFileRef("note:")).toBeNull();
    expect(parseFileRef("note:0")).toBeNull();
    expect(parseFileRef("video:3")).toBeNull();
  });
});

describe("canvasReferences", () => {
  const data = sanitizeCanvasData({
    nodes: [
      { id: "f", type: "file", file: "note:1", x: 0, y: 0, width: 100, height: 100 },
      { id: "f2", type: "file", file: "note:1", x: 0, y: 0, width: 100, height: 100 },
      text("t", { text: "see [[doc:7#x|Doc]] and ![](studybuddy-image:12) and [[note:2]]" }),
    ],
    edges: [],
  })!;

  it("collects file cards and inline links/images, deduplicated", () => {
    expect(canvasReferences(data)).toEqual([
      { type: "note", id: 1 },
      { type: "doc", id: 7 },
      { type: "note", id: 2 },
      { type: "image", id: 12 },
    ]);
  });

  it("doesn't confuse image 1 with image 12", () => {
    expect(canvasReferencesTarget(data, { type: "image", id: 12 })).toBe(true);
    expect(canvasReferencesTarget(data, { type: "image", id: 1 })).toBe(false);
  });
});

describe("nodesInsideGroup", () => {
  it("returns only nodes fully inside the group's bounds", () => {
    const group = { id: "g", x: 0, y: 0, width: 500, height: 500 };
    const nodes = [
      group,
      { id: "in", x: 10, y: 10, width: 100, height: 100 },
      { id: "edge", x: 400, y: 400, width: 100, height: 100 },
      { id: "straddling", x: 450, y: 10, width: 100, height: 100 },
      { id: "out", x: 600, y: 0, width: 50, height: 50 },
    ];
    expect(nodesInsideGroup(group, nodes)).toEqual(["in", "edge"]);
  });
});

describe("placeNodeAtDrop", () => {
  const size = { width: 200, height: 100 };

  it("attaches the new card's near side to the drop point", () => {
    expect(placeNodeAtDrop({ x: 500, y: 300 }, size, "right")).toEqual({ x: 500, y: 250, side: "left" });
    expect(placeNodeAtDrop({ x: 500, y: 300 }, size, "left")).toEqual({ x: 300, y: 250, side: "right" });
    expect(placeNodeAtDrop({ x: 500, y: 300 }, size, "bottom")).toEqual({ x: 400, y: 300, side: "top" });
    expect(placeNodeAtDrop({ x: 500, y: 300 }, size, "top")).toEqual({ x: 400, y: 200, side: "bottom" });
  });
});

describe("nearestSide", () => {
  const rect = { x: 0, y: 0, width: 200, height: 100 };
  it("picks the side of the card closest to the point", () => {
    expect(nearestSide(rect, { x: 100, y: 5 })).toBe("top");
    expect(nearestSide(rect, { x: 195, y: 50 })).toBe("right");
    expect(nearestSide(rect, { x: 100, y: 90 })).toBe("bottom");
    expect(nearestSide(rect, { x: 10, y: 50 })).toBe("left");
  });
});

describe("facingSides", () => {
  const card = (x: number, y: number) => ({ x, y, width: 200, height: 100 });
  it("uses the dominant axis between the two cards' centers", () => {
    expect(facingSides(card(0, 0), card(400, 50))).toEqual({ fromSide: "right", toSide: "left" });
    expect(facingSides(card(400, 0), card(0, 50))).toEqual({ fromSide: "left", toSide: "right" });
    expect(facingSides(card(0, 0), card(50, 300))).toEqual({ fromSide: "bottom", toSide: "top" });
    expect(facingSides(card(0, 300), card(50, 0))).toEqual({ fromSide: "top", toSide: "bottom" });
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest grid line", () => {
    expect(snapToGrid(29)).toBe(20);
    expect(snapToGrid(31)).toBe(40);
    expect(snapToGrid(-11)).toBe(-20);
  });
});

describe("duplicateSelection", () => {
  it("copies selected nodes with fresh ids and keeps only internal edges", () => {
    const data = sanitizeCanvasData({
      nodes: [text("a"), text("b", { x: 300 }), text("c", { x: 600 })],
      edges: [
        { id: "ab", fromNode: "a", toNode: "b" },
        { id: "bc", fromNode: "b", toNode: "c" },
      ],
    })!;
    let n = 0;
    const copy = duplicateSelection(data, new Set(["a", "b"]), { x: 10, y: 10 }, () => `new${n++}`);
    expect(copy.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["new0", 10, 10],
      ["new1", 310, 10],
    ]);
    expect(copy.edges).toEqual([{ id: "new2", fromNode: "new0", toNode: "new1" }]);
  });
});

describe("generateCanvasId", () => {
  it("produces Obsidian-style 16-char hex ids", () => {
    expect(generateCanvasId()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("history", () => {
  const a: CanvasData = { nodes: [], edges: [] };
  const b = sanitizeCanvasData({ nodes: [text("1")], edges: [] })!;
  const c = sanitizeCanvasData({ nodes: [text("1"), text("2")], edges: [] })!;

  it("undoes and redoes in order", () => {
    let h = pushHistory(pushHistory(createHistory(a), b), c);
    h = undoHistory(h);
    expect(h.present).toBe(b);
    h = undoHistory(h);
    expect(h.present).toBe(a);
    expect(undoHistory(h)).toBe(h);
    h = redoHistory(redoHistory(h));
    expect(h.present).toBe(c);
    expect(redoHistory(h)).toBe(h);
  });

  it("clears the redo stack on a new change", () => {
    const h = pushHistory(undoHistory(pushHistory(createHistory(a), b)), c);
    expect(h.future).toEqual([]);
  });

  it("amends the current step rather than adding one", () => {
    let h = pushHistory(createHistory(a), b);
    h = amendHistory(h, c);
    expect(h.present).toBe(c);
    expect(h.past).toEqual([a]);
    expect(undoHistory(h).present).toBe(a);
  });

  it("ignores a commit that changes nothing", () => {
    const h = pushHistory(createHistory(a), b);
    expect(pushHistory(h, structuredClone(b))).toBe(h);
  });

  it("caps how far back undo goes", () => {
    let h = createHistory(a);
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      h = pushHistory(h, { nodes: [text(String(i))] as CanvasData["nodes"], edges: [] });
    }
    expect(h.past).toHaveLength(MAX_HISTORY);
  });
});
