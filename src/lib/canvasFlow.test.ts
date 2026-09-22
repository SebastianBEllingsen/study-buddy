import { describe, it, expect } from "vitest";
import { sanitizeCanvasData } from "./canvas";
import { canvasToFlow, flowToCanvas, GROUP_Z_INDEX, CARD_Z_INDEX } from "./canvasFlow";

describe("canvasToFlow / flowToCanvas", () => {
  const data = sanitizeCanvasData({
    nodes: [
      { id: "t", type: "text", text: "**hi**", x: 1, y: 2, width: 250, height: 60, color: "3" },
      { id: "f", type: "file", file: "doc:4", subpath: "#snip", x: 300, y: 0, width: 400, height: 400 },
      { id: "l", type: "link", url: "https://example.com", x: 0, y: 500, width: 300, height: 200 },
      { id: "g", type: "group", label: "System", x: -100, y: -100, width: 1000, height: 1000 },
    ],
    edges: [
      { id: "e1", fromNode: "t", fromSide: "right", toNode: "f", toSide: "left", label: "USB", color: "5" },
      { id: "e2", fromNode: "f", toNode: "l", fromEnd: "arrow", toEnd: "none" },
    ],
  })!;

  it("round-trips every field", () => {
    const { nodes, edges } = canvasToFlow(data);
    const back = flowToCanvas(nodes, edges);
    // Groups are reordered to the front for painting — compare by id.
    const byId = (d: typeof data) => Object.fromEntries(d.nodes.map((n) => [n.id, n]));
    expect(byId(back)).toEqual(byId(data));
    expect(back.edges[0]).toEqual(data.edges[0]);
    // e2 was stored without sides, so it picks up the facing ones.
    expect(back.edges[1]).toEqual({ ...data.edges[1], fromSide: "bottom", toSide: "top" });
  });

  it("attaches a side-less edge to the sides its cards face each other on", () => {
    const sideless = sanitizeCanvasData({
      nodes: [
        { id: "l", type: "text", text: "", x: 0, y: 0, width: 200, height: 60 },
        { id: "r", type: "text", text: "", x: 500, y: 20, width: 200, height: 60 },
      ],
      edges: [{ id: "e", fromNode: "r", toNode: "l" }],
    })!;
    const [edge] = canvasToFlow(sideless).edges;
    expect([edge.sourceHandle, edge.targetHandle]).toEqual(["left", "right"]);
  });

  it("paints groups beneath cards", () => {
    const { nodes } = canvasToFlow(data);
    expect(nodes[0].id).toBe("g");
    expect(nodes[0].zIndex).toBe(GROUP_Z_INDEX);
    expect(nodes.find((n) => n.id === "t")?.zIndex).toBe(CARD_Z_INDEX);
  });

  it("applies JSON Canvas's default arrow ends", () => {
    const { edges } = canvasToFlow(data);
    expect(edges[0].data).toMatchObject({ fromEnd: "none", toEnd: "arrow" });
    expect(edges[1].data).toMatchObject({ fromEnd: "arrow", toEnd: "none" });
  });

  it("drops edges whose node was removed", () => {
    const { nodes, edges } = canvasToFlow(data);
    const back = flowToCanvas(
      nodes.filter((n) => n.id !== "f"),
      edges
    );
    expect(back.edges).toEqual([]);
  });

  it("rounds positions and falls back to measured size", () => {
    const back = flowToCanvas(
      [
        {
          id: "m",
          type: "text",
          position: { x: 10.6, y: -3.2 },
          measured: { width: 199.7, height: 80.2 },
          data: { text: "" },
        },
      ],
      []
    );
    expect(back.nodes[0]).toMatchObject({ x: 11, y: -3, width: 200, height: 80 });
  });

  it("strips transient React Flow state like selection", () => {
    const { nodes, edges } = canvasToFlow(data);
    const back = flowToCanvas(
      nodes.map((n) => ({ ...n, selected: true, dragging: true })),
      edges.map((e) => ({ ...e, selected: true }))
    );
    expect(JSON.stringify(back)).not.toContain("selected");
  });
});
