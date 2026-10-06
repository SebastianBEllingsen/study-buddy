import { beforeEach, describe, expect, it, vi } from "vitest";

// Everything the export reads is mocked: this covers what goes into the
// file, what is left out, and that one unreadable section never sinks it.
const m = vi.hoisted(() => ({
  listCourses: vi.fn(),
  listFoldersForCourse: vi.fn(),
  listDocumentsForCourse: vi.fn(),
  listGeneratedItemsForCourse: vi.fn(),
  listNotesForCourse: vi.fn(),
  listCanvasesForCourse: vi.fn(),
  getCanvas: vi.fn(),
  listQuizAttemptsForItem: vi.fn(),
  listFlashcardReviewsForItem: vi.fn(),
  listChatConversations: vi.fn(),
  getChatConversation: vi.fn(),
  listCodeSets: vi.fn(),
  getExamProfile: vi.fn(),
  getMockExam: vi.fn(),
  listAttemptsForExam: vi.fn(),
  listMockExams: vi.fn(),
  listExplainSessions: vi.fn(),
  listProblemSets: vi.fn(),
  listMistakes: vi.fn(),
  listReviewItemsForItem: vi.fn(),
  getStudyPlanForCourse: vi.fn(),
}));
vi.mock("@/lib/models", () => ({
  listCourses: m.listCourses,
  listFoldersForCourse: m.listFoldersForCourse,
  listDocumentsForCourse: m.listDocumentsForCourse,
  listGeneratedItemsForCourse: m.listGeneratedItemsForCourse,
  listNotesForCourse: m.listNotesForCourse,
  listCanvasesForCourse: m.listCanvasesForCourse,
  getCanvas: m.getCanvas,
  listQuizAttemptsForItem: m.listQuizAttemptsForItem,
  listFlashcardReviewsForItem: m.listFlashcardReviewsForItem,
  listChatConversations: m.listChatConversations,
  getChatConversation: m.getChatConversation,
}));
vi.mock("@/lib/code/store", () => ({ listCodeSets: m.listCodeSets }));
vi.mock("@/lib/exams/store", () => ({
  getExamProfile: m.getExamProfile,
  getMockExam: m.getMockExam,
  listAttemptsForExam: m.listAttemptsForExam,
  listMockExams: m.listMockExams,
}));
vi.mock("@/lib/explain/store", () => ({ listExplainSessions: m.listExplainSessions }));
vi.mock("@/lib/problems/store", () => ({ listProblemSets: m.listProblemSets }));
vi.mock("@/lib/review/mistakes", () => ({ listMistakes: m.listMistakes }));
vi.mock("@/lib/review/store", () => ({ listReviewItemsForItem: m.listReviewItemsForItem }));
vi.mock("@/lib/studyPlan/store", () => ({ getStudyPlanForCourse: m.getStudyPlanForCourse }));

const { exportAllData, EXPORT_VERSION } = await import("./exportData");

const course = { id: 1, name: "Sample course" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const fn of Object.values(m)) fn.mockReset();
  m.listCourses.mockResolvedValue([course]);
  for (const fn of [
    m.listFoldersForCourse,
    m.listDocumentsForCourse,
    m.listGeneratedItemsForCourse,
    m.listNotesForCourse,
    m.listCanvasesForCourse,
    m.listCodeSets,
    m.listMockExams,
    m.listExplainSessions,
    m.listProblemSets,
    m.listMistakes,
    m.listChatConversations,
    m.listQuizAttemptsForItem,
    m.listFlashcardReviewsForItem,
    m.listReviewItemsForItem,
  ]) {
    fn.mockResolvedValue([]);
  }
  m.getStudyPlanForCourse.mockResolvedValue(undefined);
  m.getExamProfile.mockResolvedValue(null);
});

describe("exportAllData", () => {
  it("includes the vault notes, canvases and study material the old export missed", async () => {
    m.listNotesForCourse.mockResolvedValue([{ id: 5, title: "My note", markdown: "# Hello" }]);
    m.listCanvasesForCourse.mockResolvedValue([{ id: 7, title: "Board" }]);
    m.getCanvas.mockResolvedValue({ id: 7, title: "Board", data: { nodes: [], edges: [] } });
    m.getStudyPlanForCourse.mockResolvedValue({ id: 2, title: "Plan" });
    m.listProblemSets.mockResolvedValue([{ id: 3 }]);
    m.listCodeSets.mockResolvedValue([{ id: 4 }]);
    m.listMistakes.mockResolvedValue([{ id: 9 }]);
    m.listMockExams.mockResolvedValue([{ id: 11, title: "Mock" }]);
    m.getMockExam.mockResolvedValue({ id: 11, title: "Mock", tasks: [] });
    m.listAttemptsForExam.mockResolvedValue([{ id: 12 }]);

    const payload = await exportAllData(new Date("2026-01-02T03:04:05Z"));
    const [exported] = payload.courses as Record<string, unknown>[];

    expect(payload.exportVersion).toBe(EXPORT_VERSION);
    expect(payload.exportedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(exported.notes).toEqual([{ id: 5, title: "My note", markdown: "# Hello" }]);
    expect(exported.canvases).toEqual([{ id: 7, title: "Board", data: { nodes: [], edges: [] } }]);
    expect(exported.studyPlan).toEqual({ id: 2, title: "Plan" });
    expect(exported.problemSets).toEqual([{ id: 3 }]);
    expect(exported.codeSets).toEqual([{ id: 4 }]);
    expect(exported.mistakes).toEqual([{ id: 9 }]);
    expect(exported.mockExams).toEqual([{ id: 11, title: "Mock", tasks: [], attempts: [{ id: 12 }] }]);
    expect(m.listMistakes).toHaveBeenCalledWith({ courseId: 1, status: "all" });
    expect(payload.warnings).toEqual([]);
  });

  it("exports generated items with their content, attempts and review history", async () => {
    m.listGeneratedItemsForCourse.mockResolvedValue([
      { id: 20, title: "Deck", mode: "flashcards", content_json: JSON.stringify({ cards: [{ front: "a", back: "b" }] }) },
      { id: 21, title: "Quiz", mode: "quiz", content_json: JSON.stringify({ questions: [] }) },
    ]);
    m.listFlashcardReviewsForItem.mockResolvedValue([{ id: 1 }]);
    m.listQuizAttemptsForItem.mockResolvedValue([{ id: 2 }]);
    m.listReviewItemsForItem.mockResolvedValue([{ id: 3 }]);

    const payload = await exportAllData();
    const items = (payload.courses[0] as { generatedItems: Record<string, unknown>[] }).generatedItems;

    expect(items[0]).toMatchObject({ id: 20, content: { cards: [{ front: "a", back: "b" }] }, flashcardReviews: [{ id: 1 }], quizAttempts: [] });
    expect(items[1]).toMatchObject({ id: 21, quizAttempts: [{ id: 2 }], flashcardReviews: [] });
    expect(items[0]).not.toHaveProperty("content_json");
  });

  it("leaves out file paths and file bytes of documents but keeps their trust level", async () => {
    m.listDocumentsForCourse.mockResolvedValue([
      {
        id: 1,
        course_id: 1,
        folder_id: null,
        filename: "a.pdf",
        file_path: "/some/where/a.pdf",
        file_base64: "AAAA",
        extracted_text: "text",
        page_count: 1,
        char_count: 4,
        status: "extracted",
        trust: "personal",
        error_message: null,
        created_at: "2026-01-01 00:00:00",
      },
    ]);
    const payload = await exportAllData();
    const [doc] = (payload.courses[0] as { documents: Record<string, unknown>[] }).documents;
    expect(doc).toMatchObject({ filename: "a.pdf", extracted_text: "text", trust: "personal" });
    expect(doc).not.toHaveProperty("file_path");
    expect(doc).not.toHaveProperty("file_base64");
  });

  it("keeps going when one section can't be read, and says which", async () => {
    m.listNotesForCourse.mockRejectedValue(new Error("boom"));
    m.listGeneratedItemsForCourse.mockResolvedValue([{ id: 20, title: "Bad deck", mode: "flashcards", content_json: "{not json" }]);

    const payload = await exportAllData();
    const exported = payload.courses[0] as Record<string, unknown>;

    expect(exported.notes).toEqual([]);
    expect((exported.generatedItems as Record<string, unknown>[])[0]).toMatchObject({ id: 20, content: null });
    expect(payload.warnings).toHaveLength(2);
    expect(payload.warnings.join("\n")).toContain("notes");
    expect(payload.warnings.join("\n")).toContain("Bad deck");
  });

  it("exports chats without the attachment payloads", async () => {
    m.listChatConversations.mockResolvedValue([{ id: 1, title: "Chat" }]);
    m.getChatConversation.mockResolvedValue({
      conversation: { id: 1, title: "Chat" },
      messages: [
        {
          id: 1,
          role: "user",
          content: "hi",
          attachments: [{ type: "image", filename: "a.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA" }],
        },
        { id: 2, role: "assistant", content: "hello", attachments: null },
      ],
    });

    const payload = await exportAllData();
    expect(payload.chats).toEqual([
      {
        id: 1,
        title: "Chat",
        messages: [
          { id: 1, role: "user", content: "hi", attachments: [{ type: "image", filename: "a.png", mimeType: "image/png" }] },
          { id: 2, role: "assistant", content: "hello", attachments: [] },
        ],
      },
    ]);
  });
});
