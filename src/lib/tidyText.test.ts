import { describe, it, expect, vi, beforeEach } from "vitest";

// tidyText.ts imports generateText from ./aiClient, which imports ./models
// -> ./db, whose module load connects to whatever backend
// data/storage-config.json currently points at (a real Supabase project in
// this repo). Mocked so that never happens — see grading.test.ts for the
// same concern in more detail.
const generateText = vi.fn();
vi.mock("./aiClient", () => ({ generateText }));

const { tidyPastedText } = await import("./tidyText");

beforeEach(() => {
  generateText.mockReset();
});

describe("tidyPastedText", () => {
  it("returns the cleaned text when the result length is within the accepted ratio", async () => {
    generateText.mockResolvedValue("Cleaned content.");
    const result = await tidyPastedText("Some messy pasted text that needs cleaning up.");
    expect(result).toBe("Cleaned content.");
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("restores an embedded image placeholder in the cleaned result", async () => {
    const dataUrl = "data:image/png;base64,AAAA";
    generateText.mockResolvedValue("Before [[IMAGE_0]] after, still long enough to pass the ratio check.");
    const result = await tidyPastedText(`Before ![alt](${dataUrl}) after, still long enough to pass the ratio check.`);
    expect(result).toBe(`Before ${dataUrl} after, still long enough to pass the ratio check.`);
  });

  it("retries once if the first result is far too short, then accepts a good second attempt", async () => {
    generateText.mockResolvedValueOnce("").mockResolvedValueOnce("A properly cleaned, reasonably long result.");
    const result = await tidyPastedText("A reasonably long chunk of pasted text to be tidied up here.");
    expect(result).toBe("A properly cleaned, reasonably long result.");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("retries once if the first result is far too long, then accepts a good second attempt", async () => {
    const input = "Short input.";
    generateText
      .mockResolvedValueOnce("x".repeat(input.length * 10)) // way over MAX_TIDY_RATIO
      .mockResolvedValueOnce("Cleaned.");
    const result = await tidyPastedText(input);
    expect(result).toBe("Cleaned.");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("throws after both attempts come back broken, leaving the caller able to keep the original text", async () => {
    generateText.mockResolvedValue(""); // broken both times
    await expect(tidyPastedText("A reasonably long chunk of pasted text to be tidied up here.")).rejects.toThrow(
      /broken result twice/
    );
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("skips the ratio check entirely for an empty/whitespace-only input", async () => {
    generateText.mockResolvedValue("");
    const result = await tidyPastedText("   ");
    expect(result).toBe("");
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  describe("maxTokens", () => {
    it("uses the ~4-chars-per-token estimate, not chars/2", async () => {
      // 4000 chars -> ~1000 tokens by the chars/4 estimate, well under the
      // 2000-token floor, so this pins down which estimate is in use: the
      // old chars/2 formula would compute 2000 here too (coincidentally
      // hitting the floor from the other side) at this exact length, so use
      // a size where the two formulas diverge enough to tell them apart.
      const text = "x".repeat(24_000); // chars/4 -> 6000, chars/2 -> 12000
      generateText.mockResolvedValue("x".repeat(5000)); // within MAX_TIDY_RATIO of a 24000-char input
      await tidyPastedText(text);
      expect(generateText.mock.calls[0][0].maxTokens).toBe(6000);
    });

    it("floors maxTokens at 2000 for a short paste", async () => {
      generateText.mockResolvedValue("Cleaned.");
      await tidyPastedText("short text");
      expect(generateText.mock.calls[0][0].maxTokens).toBe(2000);
    });

    // Regression coverage: the old chars/2 formula had no ceiling at all —
    // a large paste (a raw Ctrl+A page dump can easily be 100k+ characters)
    // computed a maxTokens value exceeding every supported backend's real
    // output-token limit, so the very first request on it was rejected
    // outright by the provider instead of degrading gracefully.
    it("caps maxTokens at 8000 for a very large paste", async () => {
      const huge = "x".repeat(200_000); // chars/4 -> 50000, uncapped
      generateText.mockResolvedValue("x".repeat(50_000)); // within MAX_TIDY_RATIO of a 200k input
      await tidyPastedText(huge);
      expect(generateText.mock.calls[0][0].maxTokens).toBe(8000);
    });
  });
});
