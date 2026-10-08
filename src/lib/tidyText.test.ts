import { describe, it, expect, vi, beforeEach } from "vitest";

// tidyText.ts imports generateText from ./aiClient, which imports ./models
// -> ./db, whose module load connects to whatever backend
// data/storage-config.json currently points at (possibly a real cloud
// database). Mocked so that never happens — see grading.test.ts for the
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
    it("gives the output room beyond the input's own ~4-chars-per-token size", async () => {
      const text = "x".repeat(12_000); // chars/4 -> 3000 tokens, x1.3 -> 3900
      generateText.mockResolvedValue("x".repeat(5000)); // within MAX_TIDY_RATIO of a 12000-char input
      await tidyPastedText(text);
      expect(generateText.mock.calls[0][0].maxTokens).toBe(3900);
    });

    it("floors maxTokens at 2000 for a short paste", async () => {
      generateText.mockResolvedValue("Cleaned.");
      await tidyPastedText("short text");
      expect(generateText.mock.calls[0][0].maxTokens).toBe(2000);
    });
  });

  // Regression coverage: a paste whose cleaned text can't fit in one reply
  // used to be cut off at the output limit and accepted as if complete.
  describe("a large paste", () => {
    const paragraph = (n: number) => `Paragraph ${n}. ${"word ".repeat(400)}`;
    const large = Array.from({ length: 40 }, (_, i) => paragraph(i)).join("\n\n"); // ~20k tokens

    it("is cleaned in pieces and every piece's result is kept, in order", async () => {
      generateText.mockImplementation(async (params: { user: string }) => `CLEAN(${params.user.match(/Paragraph (\d+)/)?.[1]}) ${"x".repeat(2000)}`);
      const result = await tidyPastedText(large);
      expect(generateText.mock.calls.length).toBeGreaterThan(1);
      for (const call of generateText.mock.calls) expect(call[0].maxTokens).toBeLessThanOrEqual(8000);
      expect(result.startsWith("CLEAN(0)")).toBe(true);
    });

    it("lets a piece that is only page furniture come back empty", async () => {
      let call = 0;
      generateText.mockImplementation(async () => (call++ === 1 ? "" : "x".repeat(2000)));
      const result = await tidyPastedText(large);
      expect(result.length).toBeGreaterThan(0);
    });

    it("fails if a piece stays broken, keeping the original", async () => {
      generateText.mockResolvedValue("x".repeat(400_000)); // way over the ratio every time
      await expect(tidyPastedText(large)).rejects.toThrow(/broken result twice/);
    });
  });
});
