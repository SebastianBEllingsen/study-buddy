import { describe, it, expect, vi, beforeEach } from "vitest";

const completeStep = vi.fn();
// The real parser, with the database-touching part swapped out: complete.ts
// reaches the database through these two modules.
vi.mock("@/lib/studyPlan/store", () => ({}));
vi.mock("@/lib/studyPlan/ownership", () => ({}));
vi.mock("@/lib/studyPlan/scheduleService", () => ({}));
vi.mock("@/lib/today/complete", async () => {
  const actual = await vi.importActual<typeof import("@/lib/today/complete")>("@/lib/today/complete");
  return { ...actual, completeStep: (...a: unknown[]) => completeStep(...a) };
});

const { POST } = await import("./route");

const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  completeStep.mockResolvedValue(true);
});

describe("POST /api/today/complete", () => {
  it("turns away bodies that aren't a step, including JSON that isn't an object", async () => {
    for (const body of ["not json", "null", "[1]", {}, { type: "session", planId: 1 }, { type: "resource", planId: 1 }]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(completeStep).not.toHaveBeenCalled();
  });

  it("records a session with how long it took", async () => {
    const res = await POST(post({ type: "session", planId: 2, sessionId: 9, minutes: 35 }));
    expect(res.status).toBe(200);
    expect(completeStep).toHaveBeenCalledWith({ type: "session", planId: 2, sessionId: 9, minutes: 35 });
  });

  it("ignores a minutes value that isn't a whole number", async () => {
    await POST(post({ type: "session", planId: 2, sessionId: 9, minutes: "30" }));
    expect(completeStep).toHaveBeenCalledWith({ type: "session", planId: 2, sessionId: 9 });
  });

  it("passes the chapter along with a session, so it can be found again after a reschedule", async () => {
    await POST(post({ type: "session", planId: 2, sessionId: 9, chapterId: 4 }));
    expect(completeStep).toHaveBeenCalledWith({ type: "session", planId: 2, sessionId: 9, chapterId: 4 });
  });

  it("takes a resource's progress for today, with the step's planned minutes", async () => {
    await POST(post({ type: "progress", planId: 2, resourceId: 7, minutes: 23 }));
    expect(completeStep).toHaveBeenCalledWith({ type: "progress", planId: 2, resourceId: 7, minutes: 23 });
    expect((await POST(post({ type: "progress", planId: 2 }))).status).toBe(400);
  });

  it("says when the step isn't in that plan, and when saving fails", async () => {
    completeStep.mockResolvedValueOnce(false);
    expect((await POST(post({ type: "resource", planId: 1, resourceId: 3 }))).status).toBe(404);
    completeStep.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(post({ type: "resource", planId: 1, resourceId: 3 }))).status).toBe(500);
  });
});
