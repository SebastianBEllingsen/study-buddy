import { describe, it, expect, vi, beforeEach } from "vitest";

// Covers the review settings (target retention, new cards per day) and the
// date format.
const setReviewSettings = vi.fn();
const setDateFormat = vi.fn();
const setFlashcardCardStyle = vi.fn();
const setAppBranding = vi.fn();
const getAppSettings = vi.fn();
vi.mock("@/lib/models", () => ({
  getAppSettings: (...a: unknown[]) => getAppSettings(...a),
  setReviewSettings: (...a: unknown[]) => setReviewSettings(...a),
  setDateFormat: (...a: unknown[]) => setDateFormat(...a),
  setFlashcardCardStyle: (...a: unknown[]) => setFlashcardCardStyle(...a),
  setAppBranding: (...a: unknown[]) => setAppBranding(...a),
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
  setDateFormat.mockReset();
  setFlashcardCardStyle.mockReset();
  setAppBranding.mockReset();
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

describe("POST /api/settings date format", () => {
  it("saves a known format and rejects anything else", async () => {
    expect((await post({ dateFormat: "iso" })).status).toBe(200);
    expect(setDateFormat).toHaveBeenCalledWith("iso");
    for (const dateFormat of ["de", "", 1, null]) {
      expect((await post({ dateFormat })).status).toBe(400);
    }
    expect(setDateFormat).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/settings Today card", () => {
  it("saves whether the card shows and whether it's frosted", async () => {
    expect((await post({ todayCardShown: false })).status).toBe(200);
    expect(setAppBranding).toHaveBeenLastCalledWith({ todayCardShown: false });
    expect((await post({ todayCardFrosted: false, todayCardShown: true })).status).toBe(200);
    expect(setAppBranding).toHaveBeenLastCalledWith({ todayCardShown: true, todayCardFrosted: false });
  });

  it("only takes true or false", async () => {
    for (const body of [{ todayCardShown: "no" }, { todayCardShown: 0 }, { todayCardFrosted: null }, { todayCardFrosted: [] }]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(setAppBranding).not.toHaveBeenCalled();
  });
});

describe("POST /api/settings flashcard card style", () => {
  it("saves either style", async () => {
    expect((await post({ flashcardCardStyle: "boxed" })).status).toBe(200);
    expect(setFlashcardCardStyle).toHaveBeenLastCalledWith("boxed");
    expect((await post({ flashcardCardStyle: "transparent" })).status).toBe(200);
    expect(setFlashcardCardStyle).toHaveBeenLastCalledWith("transparent");
  });

  it("rejects anything else", async () => {
    for (const value of ["glass", "", null, 1]) {
      expect((await post({ flashcardCardStyle: value })).status).toBe(400);
    }
    expect(setFlashcardCardStyle).not.toHaveBeenCalled();
  });
});
