import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers the review settings (target retention, new cards per day).
const setReviewSettings = vi.fn();
const getAppSettings = vi.fn();
vi.mock("@/lib/models", () => ({
  getAppSettings: (...a: unknown[]) => getAppSettings(...a),
  setReviewSettings: (...a: unknown[]) => setReviewSettings(...a),
  MAX_NEW_CARDS_PER_DAY: 200,
  HOME_WIDGET_IDS: [],
  IMAGE_CAPABLE_BACKENDS: [],
}));
vi.mock("@/lib/blobStorage/cleanup", () => ({ cleanupReplacedImage: vi.fn() }));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  setReviewSettings.mockReset();
  getAppSettings.mockReset().mockResolvedValue({ reviewRetention: 0.9, newCardsPerDay: 20 });
});

describe("POST /api/settings review settings", () => {
  it("saves a target retention and a daily new-card limit", async () => {
    expect((await post({ reviewRetention: 0.85 })).status).toBe(200);
    expect(setReviewSettings).toHaveBeenCalledWith({ retention: 0.85 });
    expect((await post({ newCardsPerDay: 0 })).status).toBe(200);
    expect(setReviewSettings).toHaveBeenLastCalledWith({ newCardsPerDay: 0 });
  });

  it("rejects values out of range", async () => {
    for (const body of [
      { reviewRetention: 0.5 },
      { reviewRetention: 0.99 },
      { reviewRetention: "0.9" },
      { newCardsPerDay: -1 },
      { newCardsPerDay: 201 },
      { newCardsPerDay: 2.5 },
      { newCardsPerDay: null },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(setReviewSettings).not.toHaveBeenCalled();
  });
});
