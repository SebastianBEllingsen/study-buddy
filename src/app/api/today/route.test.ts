import { describe, it, expect, vi, beforeEach } from "vitest";

const loadToday = vi.fn();
vi.mock("@/lib/today/loadToday", () => ({ loadToday: (...a: unknown[]) => loadToday(...a) }));
vi.mock("@/lib/review/queue", () => ({ DEFAULT_QUEUE_LIMIT: 100 }));
const completeStep = vi.fn();
vi.mock("@/lib/studyPlan/ownership", () => ({}));
vi.mock("@/lib/studyPlan/store", () => ({}));
vi.mock("@/lib/today/complete", async () => {
  const actual = await vi.importActual<typeof import("@/lib/today/complete")>("@/lib/today/complete");
  return { parseCompletion: actual.parseCompletion, completeStep: (...a: unknown[]) => completeStep(...a) };
});

const today = await import("./route");
const complete = await import("./complete/route");

beforeEach(() => {
  loadToday.mockReset().mockResolvedValue({ minutes: 45, steps: [], date: "2026-03-02" });
  completeStep.mockReset().mockResolvedValue(true);
});

describe("GET /api/today", () => {
  it("passes the course and a capped session length", async () => {
    await today.GET(new Request("http://localhost/api/today?courseId=4&minutes=9999"));
    expect(loadToday).toHaveBeenCalledWith(expect.objectContaining({ courseId: 4, minutes: 480 }));
    await today.GET(new Request("http://localhost/api/today?minutes=abc"));
    expect(loadToday).toHaveBeenLastCalledWith(expect.objectContaining({ courseId: null, minutes: undefined }));
  });
});

describe("POST /api/today/complete", () => {
  const post = (body: unknown) =>
    complete.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));

  it("completes a valid step, 404s one outside its plan and 400s junk", async () => {
    expect((await post({ type: "resource", planId: 1, resourceId: 2 })).status).toBe(200);
    completeStep.mockResolvedValue(false);
    expect((await post({ type: "resource", planId: 1, resourceId: 2 })).status).toBe(404);
    expect((await post({ type: "resource", planId: 1 })).status).toBe(400);
  });
});
