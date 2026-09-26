import { describe, it, expect, vi, beforeEach } from "vitest";

const getStudyPlan = vi.fn();
const setPlanOptions = vi.fn();
const renameStudyPlan = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({
  getStudyPlan: (...a: unknown[]) => getStudyPlan(...a),
  setPlanOptions: (...a: unknown[]) => setPlanOptions(...a),
  renameStudyPlan: (...a: unknown[]) => renameStudyPlan(...a),
  deleteStudyPlan: vi.fn(),
}));
const reschedulePlan = vi.fn();
vi.mock("@/lib/studyPlan/scheduleService", () => ({ reschedulePlan: (...a: unknown[]) => reschedulePlan(...a) }));

const { PATCH } = await import("./route");
const { PRESET_DEFAULTS } = await import("@/lib/studyPlan/options");

const patch = (body: unknown) => new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ planId: "1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getStudyPlan.mockResolvedValue({ id: 1, options: PRESET_DEFAULTS.roadmap });
  reschedulePlan.mockResolvedValue({ warnings: [{ type: "deadline_passed" }] });
});

describe("PATCH /api/study-plans/[planId]", () => {
  it("merges option changes without rescheduling when the schedule is untouched", async () => {
    await PATCH(patch({ options: { practice: true } }), params);
    expect(setPlanOptions).toHaveBeenCalledWith(1, { ...PRESET_DEFAULTS.roadmap, practice: true });
    expect(reschedulePlan).not.toHaveBeenCalled();
  });

  it("reschedules when schedule settings change, returning its warnings", async () => {
    const res = await PATCH(patch({ options: { schedule: true, minutesPerDay: 90 } }), params);
    expect(reschedulePlan).toHaveBeenCalledWith(1);
    expect((await res.json()).warnings).toEqual([{ type: "deadline_passed" }]);
  });

  it("never changes Google Calendar sync (it has its own route)", async () => {
    await PATCH(patch({ options: { googleCalendar: true } }), params);
    expect(setPlanOptions.mock.calls[0][1].googleCalendar).toBe(false);
  });

  it("validates title and options", async () => {
    expect((await PATCH(patch({ title: " " }), params)).status).toBe(400);
    expect((await PATCH(patch({ options: [1] }), params)).status).toBe(400);
    expect(setPlanOptions).not.toHaveBeenCalled();
  });
});
