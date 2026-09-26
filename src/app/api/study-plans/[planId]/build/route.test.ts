import { describe, it, expect, vi, beforeEach } from "vitest";

const getStudyPlan = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({ getStudyPlan: (...a: unknown[]) => getStudyPlan(...a) }));
const buildPlanResources = vi.fn();
vi.mock("@/lib/studyPlan/generatePlan", () => ({
  buildPlanResources: (...a: unknown[]) => buildPlanResources(...a),
}));
class AiDisabledError extends Error {}
vi.mock("@/lib/aiClient", () => ({ describeAiError: async () => "AI provider error", AiDisabledError }));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ planId: "1" }) };
const plan = (status: string) => ({
  id: 1,
  status,
  updated_at: "2099-01-01 00:00:00",
  chapters: [{ id: 5 }, { id: 6 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  getStudyPlan.mockResolvedValue(plan("draft_topics"));
  buildPlanResources.mockResolvedValue({ id: 1, status: "ready" });
});

describe("POST /api/study-plans/[planId]/build", () => {
  it("builds a draft with only this plan's chapter levels", async () => {
    const res = await POST(post({ levels: { "5": "known", "99": "known" } }), params);
    expect(res.status).toBe(200);
    expect(buildPlanResources).toHaveBeenCalledWith(1, new Map([[5, "known"]]));
  });

  it("refuses a plan that's already built or still building", async () => {
    getStudyPlan.mockResolvedValue(plan("ready"));
    expect((await POST(post({}), params)).status).toBe(409);
    getStudyPlan.mockResolvedValue(plan("generating"));
    expect((await POST(post({}), params)).status).toBe(409);
    expect(buildPlanResources).not.toHaveBeenCalled();
  });

  it("retries a failed plan", async () => {
    getStudyPlan.mockResolvedValue(plan("failed"));
    expect((await POST(post({}), params)).status).toBe(200);
  });

  it("400s on malformed levels and 404s for a missing plan", async () => {
    expect((await POST(post({ levels: { "5": "expert" } }), params)).status).toBe(400);
    getStudyPlan.mockResolvedValue(undefined);
    expect((await POST(post({}), params)).status).toBe(404);
  });
});
