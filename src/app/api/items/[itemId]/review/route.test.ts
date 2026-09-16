import { describe, it, expect, vi, beforeEach } from "vitest";

const logFlashcardReview = vi.fn();
const getFlashcardSchedule = vi.fn();
const upsertFlashcardSchedule = vi.fn();
const getGeneratedItem = vi.fn();
vi.mock("@/lib/models", () => ({
  logFlashcardReview: (...args: unknown[]) => logFlashcardReview(...args),
  getFlashcardSchedule: (...args: unknown[]) => getFlashcardSchedule(...args),
  upsertFlashcardSchedule: (...args: unknown[]) => upsertFlashcardSchedule(...args),
  getGeneratedItem: (...args: unknown[]) => getGeneratedItem(...args),
}));

const { POST } = await import("./route");

function req(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

const params = Promise.resolve({ itemId: "1" });

const flashcardItem = {
  id: 1,
  mode: "flashcards" as const,
  content_json: JSON.stringify({ cards: [{ front: "a", back: "b" }, { front: "c", back: "d" }] }),
};

beforeEach(() => {
  logFlashcardReview.mockReset().mockResolvedValue(undefined);
  getFlashcardSchedule.mockReset().mockResolvedValue(null);
  upsertFlashcardSchedule.mockReset().mockResolvedValue(undefined);
  getGeneratedItem.mockReset();
});

describe("POST /api/items/[itemId]/review", () => {
  it("logs a review for a valid cardIndex within the deck", async () => {
    getGeneratedItem.mockResolvedValue(flashcardItem);
    const res = await POST(req({ cardIndex: 1, result: "good" }), { params });
    expect(res.status).toBe(200);
    expect(logFlashcardReview).toHaveBeenCalledWith({ generatedItemId: 1, cardIndex: 1, result: "good" });
  });

  it("returns 404 when the item doesn't exist", async () => {
    getGeneratedItem.mockResolvedValue(undefined);
    const res = await POST(req({ cardIndex: 0, result: "good" }), { params });
    expect(res.status).toBe(404);
    expect(logFlashcardReview).not.toHaveBeenCalled();
  });

  it("returns 404 when the item exists but isn't a flashcards item", async () => {
    getGeneratedItem.mockResolvedValue({ ...flashcardItem, mode: "quiz" });
    const res = await POST(req({ cardIndex: 0, result: "good" }), { params });
    expect(res.status).toBe(404);
    expect(logFlashcardReview).not.toHaveBeenCalled();
  });

  // Regression coverage: cardIndex was previously only checked for being an
  // integer — never bounds-checked against the deck's actual card count (or
  // even checked >= 0) — so an arbitrary index could create schedule/review
  // rows for a card that doesn't exist, inflating due counts for nothing a
  // student can actually review.
  it("rejects a cardIndex at or beyond the deck's card count", async () => {
    getGeneratedItem.mockResolvedValue(flashcardItem); // 2 cards: valid indices 0, 1
    const res = await POST(req({ cardIndex: 2, result: "good" }), { params });
    expect(res.status).toBe(400);
    expect(logFlashcardReview).not.toHaveBeenCalled();
  });

  it("rejects a negative cardIndex", async () => {
    getGeneratedItem.mockResolvedValue(flashcardItem);
    const res = await POST(req({ cardIndex: -1, result: "good" }), { params });
    expect(res.status).toBe(400);
    expect(logFlashcardReview).not.toHaveBeenCalled();
  });

  it("rejects an invalid result value", async () => {
    getGeneratedItem.mockResolvedValue(flashcardItem);
    const res = await POST(req({ cardIndex: 0, result: "amazing" }), { params });
    expect(res.status).toBe(400);
    expect(logFlashcardReview).not.toHaveBeenCalled();
  });
});
