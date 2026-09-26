import { describe, it, expect, vi, beforeEach } from "vitest";

const getCourse = vi.fn();
vi.mock("@/lib/models", () => ({ getCourse: (...a: unknown[]) => getCourse(...a) }));
const describeAiError = vi.fn(async () => "AI provider error");
class AiDisabledError extends Error {}
vi.mock("@/lib/aiClient", () => ({ describeAiError: () => describeAiError(), AiDisabledError }));
vi.mock("@/lib/studyPlan/store", () => ({ getStudyPlanForCourse: vi.fn(async () => undefined) }));
const createStudyPlanForCourse = vi.fn();
vi.mock("@/lib/studyPlan/generatePlan", async () => {
  class NoCurriculumError extends Error {}
  class SyllabusNotFoundError extends Error {}
  return {
    createStudyPlanForCourse: (...a: unknown[]) => createStudyPlanForCourse(...a),
    NoCurriculumError,
    SyllabusNotFoundError,
  };
});

const { GET, POST } = await import("./route");
const { NoCurriculumError } = await import("@/lib/studyPlan/generatePlan");
const { PRESET_DEFAULTS } = await import("@/lib/studyPlan/options");

function post(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ courseId: "3" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCourse.mockResolvedValue({ id: 3, name: "Sample Course" });
  createStudyPlanForCourse.mockResolvedValue({ id: 1 });
});

describe("/api/courses/[courseId]/study-plan", () => {
  it("returns null when the course has no plan, and 404s for an unknown course", async () => {
    expect(await (await GET(new Request("http://localhost/x"), params)).json()).toEqual({ plan: null });
    getCourse.mockResolvedValue(undefined);
    expect((await GET(new Request("http://localhost/x"), params)).status).toBe(404);
  });

  it("passes a parsed request through and returns 201", async () => {
    const res = await POST(
      post({ syllabus: { text: "1. Foundations" }, folderId: 4, options: { density: "fewer", webResources: false } }),
      params
    );
    expect(res.status).toBe(201);
    expect(createStudyPlanForCourse).toHaveBeenCalledWith(3, {
      syllabus: { text: "1. Foundations" },
      folderId: 4,
      documentIds: null,
      options: { ...PRESET_DEFAULTS.roadmap, webResources: false, density: "fewer" },
    });
  });

  it("400s on a malformed syllabus without generating", async () => {
    expect((await POST(post({ syllabus: { documentId: "x" } }), params)).status).toBe(400);
    expect(createStudyPlanForCourse).not.toHaveBeenCalled();
  });

  it("maps known errors to 400 and AI failures to 502", async () => {
    createStudyPlanForCourse.mockRejectedValueOnce(new NoCurriculumError());
    expect((await POST(post({}), params)).status).toBe(400);

    vi.spyOn(console, "error").mockImplementation(() => {});
    createStudyPlanForCourse.mockRejectedValueOnce(new Error("provider down"));
    const res = await POST(post({}), params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "AI provider error" });
  });
});
