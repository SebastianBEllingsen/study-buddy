import { describe, it, expect, vi, beforeEach } from "vitest";

const reorderChapters = vi.fn();
const getStudyPlan = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({
  reorderChapters: (...a: unknown[]) => reorderChapters(...a),
  getStudyPlan: (...a: unknown[]) => getStudyPlan(...a),
}));
const rescheduleQuietly = vi.fn();
vi.mock("@/lib/studyPlan/scheduleService", () => ({ rescheduleQuietly: (...a: unknown[]) => rescheduleQuietly(...a) }));

const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ planId: "1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  getStudyPlan.mockResolvedValue({ id: 1, options: { schedule: true } });
});

describe("POST /api/study-plans/[planId]/chapters/reorder", () => {
  it("reorders and rebuilds a scheduled plan, since the schedule follows roadmap order", async () => {
    expect((await post({ orderedIds: [3, 1, 2] })).status).toBe(200);
    expect(reorderChapters).toHaveBeenCalledWith(1, [3, 1, 2]);
    expect(rescheduleQuietly).toHaveBeenCalledWith(1);
  });

  it("leaves a plan without a schedule alone, and turns away a bad list", async () => {
    getStudyPlan.mockResolvedValue({ id: 1, options: { schedule: false } });
    await post({ orderedIds: [1, 2] });
    expect(rescheduleQuietly).not.toHaveBeenCalled();
    expect((await post({ orderedIds: [1, 1] })).status).toBe(400);
  });
});
