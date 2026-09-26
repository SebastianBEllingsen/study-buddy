import { describe, it, expect, vi, beforeEach } from "vitest";

const getGeneratedItem = vi.fn();
vi.mock("@/lib/models", () => ({ getGeneratedItem: (...a: unknown[]) => getGeneratedItem(...a) }));
vi.mock("@/lib/aiClient", () => ({ describeAiError: vi.fn().mockResolvedValue("AI error") }));
const gradeQuizAnswers = vi.fn();
vi.mock("@/lib/quizGrading", () => ({ gradeQuizAnswers: (...a: unknown[]) => gradeQuizAnswers(...a) }));
const recordCardAnswer = vi.fn();
const recordQuizAnswers = vi.fn();
vi.mock("@/lib/review/answers", () => ({
  recordCardAnswer: (...a: unknown[]) => recordCardAnswer(...a),
  recordQuizAnswers: (...a: unknown[]) => recordQuizAnswers(...a),
}));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/review/answer", { method: "POST", body: JSON.stringify(body) }));

const deck = { id: 1, mode: "flashcards", content_json: JSON.stringify({ cards: [{ front: "F", back: "B" }] }) };
const quiz = {
  id: 2,
  mode: "quiz",
  content_json: JSON.stringify({
    questions: [{ type: "mcq", question: "Q", options: ["a", "b"], correctIndex: 0, explanation: "e" }],
  }),
};
const graded = { index: 0, type: "mcq", correct: true, feedback: "Correct.", explanation: "e", correctAnswer: "a" };

beforeEach(() => {
  getGeneratedItem.mockReset();
  gradeQuizAnswers.mockReset().mockResolvedValue([graded]);
  recordCardAnswer.mockReset().mockResolvedValue({ index: 0, scheduled: true, dueAt: "2026-03-03 06:00:00" });
  recordQuizAnswers.mockReset().mockResolvedValue([{ index: 0, scheduled: true, dueAt: "2026-03-05 06:00:00" }]);
});

describe("POST /api/review/answer", () => {
  it("records a card rating from the review session", async () => {
    getGeneratedItem.mockResolvedValue(deck);
    const res = await post({ itemId: 1, kind: "card", index: 0, result: "hard", confidence: "unsure" });
    expect(res.status).toBe(200);
    expect(recordCardAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ cardIndex: 0, result: "hard", confidence: "unsure", source: "queue" })
    );
    expect(await res.json()).toEqual({ scheduled: true, dueAt: "2026-03-03 06:00:00" });
  });

  it("grades a question and records it", async () => {
    getGeneratedItem.mockResolvedValue(quiz);
    const res = await post({ itemId: 2, kind: "question", index: 0, answer: 0, confidence: "sure" });
    expect(res.status).toBe(200);
    expect(gradeQuizAnswers).toHaveBeenCalledWith([expect.objectContaining({ index: 0, answer: 0 })]);
    expect(recordQuizAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ source: "queue", entries: [expect.objectContaining({ confidence: "sure", result: graded })] })
    );
    expect(await res.json()).toMatchObject({ result: graded, scheduled: true });
  });

  it("grades without recording a re-ask", async () => {
    getGeneratedItem.mockResolvedValue(quiz);
    const res = await post({ itemId: 2, kind: "question", index: 0, answer: 1, record: false });
    expect(await res.json()).toMatchObject({ result: graded, scheduled: false });
    expect(recordQuizAnswers).not.toHaveBeenCalled();

    getGeneratedItem.mockResolvedValue(deck);
    await post({ itemId: 1, kind: "card", index: 0, result: "good", record: false });
    expect(recordCardAnswer).not.toHaveBeenCalled();
  });

  it("rejects mismatched kinds, bad indexes and bad payloads", async () => {
    getGeneratedItem.mockResolvedValue(deck);
    expect((await post({ itemId: 1, kind: "question", index: 0, answer: 0 })).status).toBe(404);
    expect((await post({ itemId: 1, kind: "card", index: 5, result: "good" })).status).toBe(400);
    expect((await post({ itemId: 1, kind: "card", index: 0, result: "great" })).status).toBe(400);
    expect((await post({ itemId: 1, kind: "card", index: 0, result: "good", confidence: "maybe" })).status).toBe(400);
    expect((await post({ itemId: "1", kind: "card", index: 0, result: "good" })).status).toBe(400);
    getGeneratedItem.mockResolvedValue(quiz);
    expect((await post({ itemId: 2, kind: "question", index: 0, answer: { x: 1 } })).status).toBe(400);
    expect(recordCardAnswer).not.toHaveBeenCalled();
    expect(recordQuizAnswers).not.toHaveBeenCalled();
  });
});
