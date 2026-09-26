import { describe, it, expect, vi, beforeEach } from "vitest";

const getStudyPlan = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({ getStudyPlan: (...a: unknown[]) => getStudyPlan(...a) }));
const findNewPlanDocuments = vi.fn();
const supplementStudyPlan = vi.fn();
class NoNewMaterialError extends Error {}
vi.mock("@/lib/studyPlan/supplement", () => ({
  findNewPlanDocuments: (...a: unknown[]) => findNewPlanDocuments(...a),
  supplementStudyPlan: (...a: unknown[]) => supplementStudyPlan(...a),
  NoNewMaterialError,
}));
vi.mock("@/lib/studyPlan/resources", () => ({ StudyPlanNotFoundError: class extends Error {} }));
class AiDisabledError extends Error {}
vi.mock("@/lib/aiClient", () => ({ describeAiError: async () => "AI provider error", AiDisabledError }));

const { GET, POST } = await import("./route");
const params = { params: Promise.resolve({ planId: "1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getStudyPlan.mockResolvedValue({ id: 1 });
});

describe("/api/study-plans/[planId]/supplement", () => {
  it("lists new documents by id and filename only", async () => {
    findNewPlanDocuments.mockResolvedValue([{ id: 3, filename: "Lecture7.pdf", extracted_text: "secret" }]);
    expect(await (await GET(new Request("http://localhost/x"), params)).json()).toEqual({
      documents: [{ id: 3, filename: "Lecture7.pdf" }],
    });
  });

  it("maps nothing-new to 400 and AI failures to 502", async () => {
    supplementStudyPlan.mockRejectedValueOnce(new NoNewMaterialError("none"));
    expect((await POST(new Request("http://localhost/x"), params)).status).toBe(400);
    vi.spyOn(console, "error").mockImplementation(() => {});
    supplementStudyPlan.mockRejectedValueOnce(new Error("provider down"));
    expect((await POST(new Request("http://localhost/x"), params)).status).toBe(502);
  });
});
