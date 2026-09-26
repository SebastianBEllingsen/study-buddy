import { describe, it, expect, vi, beforeEach } from "vitest";

const generateForCourse = vi.fn();
class NoDocumentsError extends Error {}
vi.mock("@/lib/generate", () => ({ generateForCourse: (...a: unknown[]) => generateForCourse(...a), NoDocumentsError }));
class AiDisabledError extends Error {}
vi.mock("@/lib/aiClient", () => ({ describeAiError: async () => "AI provider error", AiDisabledError }));
vi.mock("@/lib/models", () => ({
  createGenerationNotification: vi.fn(),
  getAppSettings: async () => ({ autoOpenGeneratedItems: true }),
}));
const getStudyPlan = vi.fn();
const getChapter = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({
  getStudyPlan: (...a: unknown[]) => getStudyPlan(...a),
  getChapter: (...a: unknown[]) => getChapter(...a),
}));

const { POST } = await import("./route");

const post = (body: unknown = {}) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const params = (mode = "quiz") => ({ params: Promise.resolve({ planId: "1", chapterId: "5", mode }) });

beforeEach(() => {
  vi.clearAllMocks();
  getStudyPlan.mockResolvedValue({ id: 1, course_id: 3 });
  getChapter.mockResolvedValue({
    id: 5,
    plan_id: 1,
    title: "Foundations",
    summary: "S",
    subtopics: [{ text: "A", done: false }],
    linked_document_ids: [8],
  });
  generateForCourse.mockResolvedValue({ id: 99 });
});

describe("POST /api/study-plans/[planId]/chapters/[chapterId]/generate/[mode]", () => {
  it("generates for the chapter from its documents, filed on the course page", async () => {
    const res = await POST(post({ quizSettings: { singleChoice: true } }), params());
    expect(res.status).toBe(201);
    expect(generateForCourse).toHaveBeenCalledWith(3, "quiz", {
      documentIds: [8],
      quizSettings: { singleChoice: true, multipleChoice: false, shortAnswer: false },
      destinationFolderId: null,
      studyPlanChapter: { id: 5, title: "Foundations", summary: "S", subtopics: ["A"] },
    });
  });

  it("passes no documents for a chapter without any", async () => {
    getChapter.mockResolvedValue({ id: 5, plan_id: 1, title: "T", summary: "", subtopics: [], linked_document_ids: [] });
    await POST(post(), params("notes"));
    expect(generateForCourse.mock.calls[0][2].documentIds).toBeNull();
  });

  it("rejects an unknown mode and a chapter from another plan", async () => {
    expect((await POST(post(), params("essay"))).status).toBe(400);
    getChapter.mockResolvedValue({ id: 5, plan_id: 2, subtopics: [], linked_document_ids: [] });
    expect((await POST(post(), params())).status).toBe(404);
    expect(generateForCourse).not.toHaveBeenCalled();
  });
});
