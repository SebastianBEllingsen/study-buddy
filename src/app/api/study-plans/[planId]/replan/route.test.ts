import { describe, it, expect, vi, beforeEach } from "vitest";

const getStudyPlan = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({ getStudyPlan: (...a: unknown[]) => getStudyPlan(...a) }));
vi.mock("@/lib/studyPlan/resources", () => ({
  StudyPlanNotFoundError: class StudyPlanNotFoundError extends Error {},
}));
const replanStudyPlan = vi.fn();
vi.mock("@/lib/studyPlan/replan", () => ({ replanStudyPlan: (...a: unknown[]) => replanStudyPlan(...a) }));

const { POST } = await import("./route");

const post = (body?: string) => POST(new Request("http://localhost/x", { method: "POST", body }), { params: Promise.resolve({ planId: "1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  getStudyPlan.mockResolvedValue({ id: 1, options: { schedule: true } });
  replanStudyPlan.mockResolvedValue({ message: "ok", warnings: [], extraReview: [] });
});

describe("POST /api/study-plans/[planId]/replan", () => {
  it("404s for a missing plan and 400s for one with no schedule", async () => {
    getStudyPlan.mockResolvedValueOnce(undefined);
    expect((await post()).status).toBe(404);
    getStudyPlan.mockResolvedValueOnce({ id: 1, options: { schedule: false } });
    expect((await post()).status).toBe(400);
    expect(replanStudyPlan).not.toHaveBeenCalled();
  });

  it("uses the AI unless told not to — and any odd body counts as 'use it'", async () => {
    for (const body of [undefined, "", "null", "[1]", "not json", "{}", '{"useAi":true}']) {
      await post(body);
      expect(replanStudyPlan).toHaveBeenLastCalledWith(1, { useAi: true });
    }
    await post('{"useAi":false}');
    expect(replanStudyPlan).toHaveBeenLastCalledWith(1, { useAi: false });
  });
});
