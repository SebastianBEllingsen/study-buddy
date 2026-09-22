import { describe, it, expect, vi, beforeEach } from "vitest";

const getCanvas = vi.fn();
const renameCanvas = vi.fn();
const updateCanvasData = vi.fn();
const deleteCanvas = vi.fn();
vi.mock("@/lib/models", () => ({
  getCanvas: (...args: unknown[]) => getCanvas(...args),
  renameCanvas: (...args: unknown[]) => renameCanvas(...args),
  updateCanvasData: (...args: unknown[]) => updateCanvasData(...args),
  deleteCanvas: (...args: unknown[]) => deleteCanvas(...args),
}));

const { GET, PATCH } = await import("./route");

function patch(body: unknown): Request {
  return new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });
}

const params = Promise.resolve({ canvasId: "1" });

beforeEach(() => {
  vi.clearAllMocks();
  getCanvas.mockResolvedValue({ id: 1, title: "C", data: { nodes: [], edges: [] } });
});

describe("GET /api/canvases/[canvasId]", () => {
  it("404s for an unknown canvas", async () => {
    getCanvas.mockResolvedValue(undefined);
    expect((await GET(new Request("http://localhost/x"), { params })).status).toBe(404);
  });
});

describe("PATCH /api/canvases/[canvasId]", () => {
  it("stores sanitized data, dropping edges to missing nodes", async () => {
    const res = await PATCH(
      patch({
        data: {
          nodes: [{ id: "a", type: "text", text: "x", x: 0, y: 0, width: 250, height: 60 }],
          edges: [{ id: "e", fromNode: "a", toNode: "gone" }],
        },
      }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(updateCanvasData).toHaveBeenCalledWith(1, {
      nodes: [{ id: "a", type: "text", text: "x", x: 0, y: 0, width: 250, height: 60 }],
      edges: [],
    });
  });

  it("rejects data that isn't a canvas without writing anything", async () => {
    const res = await PATCH(patch({ title: "New", data: { nodes: "nope" } }), { params });
    expect(res.status).toBe(400);
    expect(renameCanvas).not.toHaveBeenCalled();
    expect(updateCanvasData).not.toHaveBeenCalled();
  });

  it("rejects a blank title", async () => {
    const res = await PATCH(patch({ title: "   " }), { params });
    expect(res.status).toBe(400);
    expect(renameCanvas).not.toHaveBeenCalled();
  });

  it("renames with a trimmed title", async () => {
    await PATCH(patch({ title: "  Laptop  " }), { params });
    expect(renameCanvas).toHaveBeenCalledWith(1, "Laptop");
  });

  it("404s for an unknown canvas", async () => {
    getCanvas.mockResolvedValue(undefined);
    expect((await PATCH(patch({ title: "x" }), { params })).status).toBe(404);
  });
});
