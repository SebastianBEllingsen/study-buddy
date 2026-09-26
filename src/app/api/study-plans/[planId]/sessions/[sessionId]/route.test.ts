import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const setSessionDone = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({
  getSession: (...a: unknown[]) => getSession(...a),
  setSessionDone: (...a: unknown[]) => setSessionDone(...a),
}));

const { PATCH } = await import("./route");

const patch = (body: unknown) => new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ planId: "1", sessionId: "4" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: 4, plan_id: 1 });
});

describe("PATCH /api/study-plans/[planId]/sessions/[sessionId]", () => {
  it("ticks a session off", async () => {
    expect((await PATCH(patch({ done: true }), params)).status).toBe(200);
    expect(setSessionDone).toHaveBeenCalledWith(4, true);
  });

  it("404s for another plan's session and 400s on a bad body", async () => {
    expect((await PATCH(patch({ done: "yes" }), params)).status).toBe(400);
    getSession.mockResolvedValue({ id: 4, plan_id: 2 });
    expect((await PATCH(patch({ done: true }), params)).status).toBe(404);
    expect(setSessionDone).not.toHaveBeenCalled();
  });
});
