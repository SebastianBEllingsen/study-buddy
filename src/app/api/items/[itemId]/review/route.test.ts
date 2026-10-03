import { describe, it, expect, vi, beforeEach } from "vitest";

const getGeneratedItem = vi.fn();
vi.mock("@/lib/models", () => ({ getGeneratedItem: (...a: unknown[]) => getGeneratedItem(...a) }));
const recordCardAnswer = vi.fn();
vi.mock("@/lib/review/answers", () => ({ recordCardAnswer: (...a: unknown[]) => recordCardAnswer(...a) }));

const { POST } = await import("./route");

const post = (body: string) =>
  POST(new Request("http://localhost/x", { method: "POST", body }), { params: Promise.resolve({ itemId: "4" }) });

beforeEach(() => {
  vi.clearAllMocks();
  getGeneratedItem.mockResolvedValue({ id: 4, mode: "flashcards", content_json: JSON.stringify({ cards: [{ front: "a", back: "b" }] }) });
  recordCardAnswer.mockResolvedValue({ dueAt: "2026-01-01 00:00:00", scheduled: true });
});

describe("POST /api/items/[itemId]/review", () => {
  it("answers 400, not 500, for a body that isn't a review", async () => {
    for (const body of ["not json", "null", "[1]", "{}", '{"cardIndex":5,"result":"good"}', '{"cardIndex":0,"result":"great"}']) {
      expect((await post(body)).status).toBe(400);
    }
    expect(recordCardAnswer).not.toHaveBeenCalled();
  });

  it("records a valid review", async () => {
    const res = await post('{"cardIndex":0,"result":"good","confidence":"sure"}');
    expect(res.status).toBe(200);
    expect(recordCardAnswer).toHaveBeenCalledWith(expect.objectContaining({ cardIndex: 0, result: "good", confidence: "sure", source: "deck" }));
  });

  it("404s for an item that isn't a flashcard deck", async () => {
    getGeneratedItem.mockResolvedValueOnce({ id: 4, mode: "quiz", content_json: "{}" });
    expect((await post('{"cardIndex":0,"result":"good"}')).status).toBe(404);
  });
});
