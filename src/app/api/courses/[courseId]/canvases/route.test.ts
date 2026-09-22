import { describe, it, expect, vi, beforeEach } from "vitest";

const createCanvas = vi.fn();
vi.mock("@/lib/models", () => ({
  createCanvas: (...args: unknown[]) => createCanvas(...args),
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

const params = Promise.resolve({ courseId: "3" });

beforeEach(() => {
  vi.clearAllMocks();
  createCanvas.mockResolvedValue({ id: 1 });
});

describe("POST /api/courses/[courseId]/canvases", () => {
  it("creates an empty canvas when no data is given", async () => {
    const res = await POST(post({ title: " Board " }), { params });
    expect(res.status).toBe(201);
    expect(createCanvas).toHaveBeenCalledWith("Board", 3, undefined);
  });

  it("imports sanitized data from a .canvas file", async () => {
    await POST(
      post({
        title: "Imported",
        data: {
          nodes: [
            { id: "a", type: "text", text: "x", x: 0, y: 0, width: 250, height: 60 },
            { id: "b", type: "hologram", x: 0, y: 0, width: 1, height: 1 },
          ],
          edges: [],
        },
      }),
      { params }
    );
    expect(createCanvas).toHaveBeenCalledWith("Imported", 3, {
      nodes: [{ id: "a", type: "text", text: "x", x: 0, y: 0, width: 250, height: 60 }],
      edges: [],
    });
  });

  it("rejects data that isn't a canvas", async () => {
    const res = await POST(post({ title: "Bad", data: [1, 2, 3] }), { params });
    expect(res.status).toBe(400);
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("requires a title", async () => {
    expect((await POST(post({ title: "" }), { params })).status).toBe(400);
  });
});
