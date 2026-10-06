import { describe, it, expect, vi, beforeEach } from "vitest";

const getGeneratedItem = vi.fn();
const updateGeneratedItemContent = vi.fn();
vi.mock("@/lib/models", () => ({
  getGeneratedItem: (...a: unknown[]) => getGeneratedItem(...a),
  updateGeneratedItemContent: (...a: unknown[]) => updateGeneratedItemContent(...a),
  moveGeneratedItem: vi.fn(),
  deleteGeneratedItem: vi.fn(),
  listRecentQuizAttemptsForItem: vi.fn(),
  getBestQuizScoreForItem: vi.fn(),
  getNewDocumentsForItem: vi.fn(),
  cardDueRowsForItem: vi.fn(),
  reverseDueRowsForItem: vi.fn(),
}));
vi.mock("@/lib/review/legacyMigration", () => ({ ensureFsrsMigrated: vi.fn() }));
vi.mock("@/lib/review/store", () => ({ reconcileReviewItemsAfterRemoval: vi.fn() }));
vi.mock("@/lib/dueCards", () => ({ deckDueCardIndices: vi.fn(), deckDueReverseIndices: vi.fn() }));
vi.mock("@/lib/blobStorage/cleanup", () => ({ removeUnreferencedBlobs: vi.fn() }));

const { PATCH } = await import("./route");

const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/items/5", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ itemId: "5" }),
  });

const cards = [{ front: "a", back: "b" }];

beforeEach(() => {
  getGeneratedItem.mockReset();
  updateGeneratedItemContent.mockReset().mockResolvedValue({});
});

describe("PATCH /api/items/[itemId] reminders", () => {
  it("turns a set's reminders off by storing false, keeping the rest of its content", async () => {
    getGeneratedItem.mockResolvedValue({
      mode: "flashcards",
      content_json: JSON.stringify({ cards, styles: { "1": ".card{}" } }),
      source_document_ids: "[]",
    });
    expect((await patch({ reminders: false })).status).toBe(200);
    expect(updateGeneratedItemContent).toHaveBeenCalledWith({
      id: 5,
      contentJson: { cards, styles: { "1": ".card{}" }, reminders: false },
      sourceDocumentIds: [],
    });
  });

  it("turns them back on by dropping the key", async () => {
    getGeneratedItem.mockResolvedValue({
      mode: "flashcards",
      content_json: JSON.stringify({ cards, reminders: false }),
      source_document_ids: "[]",
    });
    expect((await patch({ reminders: true })).status).toBe(200);
    expect(updateGeneratedItemContent.mock.calls[0][0].contentJson).toEqual({ cards });
  });

  it("refuses sets that aren't flashcards, and items that don't exist", async () => {
    getGeneratedItem.mockResolvedValue({ mode: "quiz", content_json: "{}", source_document_ids: "[]" });
    expect((await patch({ reminders: false })).status).toBe(400);
    getGeneratedItem.mockResolvedValue(undefined);
    expect((await patch({ reminders: false })).status).toBe(404);
    expect(updateGeneratedItemContent).not.toHaveBeenCalled();
  });
});
