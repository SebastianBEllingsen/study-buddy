import { describe, it, expect, vi, beforeEach } from "vitest";

const getGeneratedItem = vi.fn();
const createQuizAttempt = vi.fn();
const completeQuizAttempt = vi.fn();
const deleteQuizAttempt = vi.fn();
const getAppSettings = vi.fn();
vi.mock("@/lib/models", () => ({
  getGeneratedItem: (...args: unknown[]) => getGeneratedItem(...args),
  createQuizAttempt: (...args: unknown[]) => createQuizAttempt(...args),
  completeQuizAttempt: (...args: unknown[]) => completeQuizAttempt(...args),
  deleteQuizAttempt: (...args: unknown[]) => deleteQuizAttempt(...args),
  getAppSettings: (...args: unknown[]) => getAppSettings(...args),
}));

const gradeShortAnswers = vi.fn();
const gradeShortAnswersLocally = vi.fn();
vi.mock("@/lib/grading", () => ({
  gradeShortAnswers: (...args: unknown[]) => gradeShortAnswers(...args),
  gradeShortAnswersLocally: (...args: unknown[]) => gradeShortAnswersLocally(...args),
}));

vi.mock("@/lib/aiClient", () => ({ describeAiError: vi.fn().mockResolvedValue("AI error") }));

const recordQuizAnswers = vi.fn();
vi.mock("@/lib/review/answers", () => ({
  recordQuizAnswers: (...args: unknown[]) => recordQuizAnswers(...args),
}));

const { POST } = await import("./route");

function req(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

const params = Promise.resolve({ itemId: "1" });

const quizItem = {
  id: 1,
  mode: "quiz" as const,
  content_json: JSON.stringify({
    questions: [{ type: "mcq", question: "Q1", options: ["a", "b"], correctIndex: 0, explanation: "e" }],
  }),
};

beforeEach(() => {
  getGeneratedItem.mockReset();
  createQuizAttempt.mockReset();
  completeQuizAttempt.mockReset();
  deleteQuizAttempt.mockReset().mockResolvedValue(undefined);
  getAppSettings.mockReset().mockResolvedValue({ aiEnabled: false, aiGradingEnabled: false });
  gradeShortAnswers.mockReset();
  gradeShortAnswersLocally.mockReset();
  recordQuizAnswers.mockReset().mockResolvedValue([]);
});

describe("POST /api/items/[itemId]/attempt", () => {
  it("creates and completes an attempt for an all-mcq quiz", async () => {
    getGeneratedItem.mockResolvedValue(quizItem);
    createQuizAttempt.mockResolvedValue({ id: 42 });

    const res = await POST(req({ answers: [0] }), { params });

    expect(res.status).toBe(200);
    expect(completeQuizAttempt).toHaveBeenCalledWith(expect.objectContaining({ id: 42, score: 100 }));
    expect(deleteQuizAttempt).not.toHaveBeenCalled();
  });

  it("records each answer for spaced review with its confidence", async () => {
    getGeneratedItem.mockResolvedValue(quizItem);
    createQuizAttempt.mockResolvedValue({ id: 42 });

    await POST(req({ answers: [1], confidences: ["sure"] }), { params });

    expect(recordQuizAnswers).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "quiz",
        entries: [
          expect.objectContaining({
            answer: 1,
            confidence: "sure",
            result: expect.objectContaining({ index: 0, correct: false, correctAnswer: "a" }),
          }),
        ],
      })
    );
  });

  it("ignores unknown confidence values", async () => {
    getGeneratedItem.mockResolvedValue(quizItem);
    createQuizAttempt.mockResolvedValue({ id: 42 });

    await POST(req({ answers: [0], confidences: ["certain"] }), { params });

    expect(recordQuizAnswers.mock.calls[0][0].entries[0].confidence).toBeNull();
  });

  it("still returns the graded attempt when recording for review fails", async () => {
    getGeneratedItem.mockResolvedValue(quizItem);
    createQuizAttempt.mockResolvedValue({ id: 42 });
    recordQuizAnswers.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(req({ answers: [0] }), { params });

    expect(res.status).toBe(200);
    expect(deleteQuizAttempt).not.toHaveBeenCalled();
  });

  // Regression coverage: createQuizAttempt runs before grading. If grading
  // fails (a real API call, can be rate-limited), the attempt it already
  // created must not survive as a permanent, score-less row in "Previous
  // attempts" — see deleteQuizAttempt's own comment in models.ts.
  it("rolls back the created attempt when grading a short-answer question fails", async () => {
    const itemWithShortAnswer = {
      ...quizItem,
      content_json: JSON.stringify({
        questions: [{ type: "short_answer", question: "Q1", modelAnswer: "answer", explanation: "e" }],
      }),
    };
    getGeneratedItem.mockResolvedValue(itemWithShortAnswer);
    createQuizAttempt.mockResolvedValue({ id: 42 });
    getAppSettings.mockResolvedValue({ aiEnabled: true, aiGradingEnabled: true });
    gradeShortAnswers.mockRejectedValue(new Error("rate limited"));

    const res = await POST(req({ answers: ["my answer"] }), { params });

    expect(res.status).toBe(502);
    expect(deleteQuizAttempt).toHaveBeenCalledWith(42);
    expect(completeQuizAttempt).not.toHaveBeenCalled();
  });

  it("does not attempt a rollback when the failure happens before an attempt was created", async () => {
    getGeneratedItem.mockResolvedValue(undefined);

    const res = await POST(req({ answers: [] }), { params });

    expect(res.status).toBe(404);
    expect(deleteQuizAttempt).not.toHaveBeenCalled();
  });
});
