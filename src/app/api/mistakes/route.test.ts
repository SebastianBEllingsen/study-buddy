import { describe, it, expect, vi, beforeEach } from "vitest";

const listMistakes = vi.fn();
const getMistake = vi.fn();
const setMistakeResolved = vi.fn();
vi.mock("@/lib/review/mistakes", () => ({
  listMistakes: (...a: unknown[]) => listMistakes(...a),
  getMistake: (...a: unknown[]) => getMistake(...a),
  setMistakeResolved: (...a: unknown[]) => setMistakeResolved(...a),
}));
const explainMistakes = vi.fn();
vi.mock("@/lib/review/explainMistakes", () => ({ explainMistakes: (...a: unknown[]) => explainMistakes(...a) }));
class AiDisabledError extends Error {}
vi.mock("@/lib/aiClient", () => ({ AiDisabledError, describeAiError: vi.fn().mockResolvedValue("AI error") }));

const list = await import("./route");
const one = await import("./[mistakeId]/route");
const explain = await import("./explain/route");

beforeEach(() => {
  listMistakes.mockReset().mockResolvedValue([]);
  getMistake.mockReset();
  setMistakeResolved.mockReset();
  explainMistakes.mockReset();
});

describe("GET /api/mistakes", () => {
  it("filters by course and status", async () => {
    await list.GET(new Request("http://localhost/api/mistakes?courseId=3&status=all"));
    expect(listMistakes).toHaveBeenCalledWith({ courseId: 3, status: "all" });
    await list.GET(new Request("http://localhost/api/mistakes"));
    expect(listMistakes).toHaveBeenLastCalledWith({ courseId: null, status: "open" });
    expect((await list.GET(new Request("http://localhost/api/mistakes?status=old"))).status).toBe(400);
  });
});

describe("PATCH /api/mistakes/[mistakeId]", () => {
  const patch = (id: string, body: unknown) =>
    one.PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), {
      params: Promise.resolve({ mistakeId: id }),
    });

  it("resolves or reopens an existing mistake", async () => {
    getMistake.mockResolvedValue({ id: 4 });
    expect((await patch("4", { resolved: true })).status).toBe(200);
    expect(setMistakeResolved).toHaveBeenCalledWith(4, true);
  });

  it("404s an unknown mistake and 400s a bad body", async () => {
    getMistake.mockResolvedValue(undefined);
    expect((await patch("4", { resolved: false })).status).toBe(404);
    expect((await patch("x", { resolved: false })).status).toBe(404);
    expect((await patch("4", { resolved: "yes" })).status).toBe(400);
    expect(setMistakeResolved).not.toHaveBeenCalled();
  });
});

describe("POST /api/mistakes/explain", () => {
  const post = (body: unknown) =>
    explain.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));

  it("explains a course's mistakes, or all of them", async () => {
    explainMistakes.mockResolvedValue({ labeled: 2, remaining: 0 });
    expect(await (await post({ courseId: 3 })).json()).toEqual({ labeled: 2, remaining: 0 });
    expect(explainMistakes).toHaveBeenCalledWith(3);
    await post({});
    expect(explainMistakes).toHaveBeenLastCalledWith(null);
    expect((await post({ courseId: "3" })).status).toBe(400);
  });

  it("returns 400 when AI is off", async () => {
    explainMistakes.mockRejectedValue(new AiDisabledError("AI is turned off"));
    expect((await post({})).status).toBe(400);
  });
});
