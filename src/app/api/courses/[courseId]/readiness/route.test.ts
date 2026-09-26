import { describe, it, expect, vi, beforeEach } from "vitest";

const getCourse = vi.fn();
vi.mock("@/lib/models", () => ({ getCourse: (...a: unknown[]) => getCourse(...a) }));
const setExamDate = vi.fn();
const loadReadiness = vi.fn();
vi.mock("@/lib/readiness/load", () => ({
  setExamDate: (...a: unknown[]) => setExamDate(...a),
  loadReadiness: (...a: unknown[]) => loadReadiness(...a),
}));

const route = await import("./route");
const explain = await import("../explain/route");
const params = Promise.resolve({ courseId: "4" });
const put = (body: unknown) => route.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }), { params });

vi.mock("@/lib/explain/flow", () => ({
  ExplainSessionError: class extends Error {},
  startExplainSession: vi.fn().mockResolvedValue({ id: 1 }),
}));
vi.mock("@/lib/explain/store", () => ({ listExplainSessions: vi.fn().mockResolvedValue([]) }));

beforeEach(() => {
  getCourse.mockReset().mockResolvedValue({ id: 4, name: "Sample Course" });
  setExamDate.mockReset();
  loadReadiness.mockReset().mockResolvedValue({ examDate: null });
});

describe("PUT /api/courses/[courseId]/readiness", () => {
  it("sets or clears a valid exam date", async () => {
    expect((await put({ examDate: "2026-06-01" })).status).toBe(200);
    expect(setExamDate).toHaveBeenCalledWith(4, "2026-06-01");
    expect((await put({ examDate: null })).status).toBe(200);
    expect(setExamDate).toHaveBeenLastCalledWith(4, null);
  });

  it("rejects a malformed date and an unknown course", async () => {
    expect((await put({ examDate: "June 1st" })).status).toBe(400);
    getCourse.mockResolvedValue(undefined);
    expect((await put({ examDate: "2026-06-01" })).status).toBe(404);
    expect(setExamDate).not.toHaveBeenCalled();
  });
});

describe("POST /api/courses/[courseId]/explain", () => {
  const post = (body: unknown) => explain.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params });
  it("starts a session of a known kind only", async () => {
    expect((await post({ kind: "blurt", topic: "Graphs" })).status).toBe(201);
    expect((await post({ kind: "essay", topic: "Graphs" })).status).toBe(400);
    expect((await post({ kind: "blurt", chapterId: "x" })).status).toBe(400);
  });
});
