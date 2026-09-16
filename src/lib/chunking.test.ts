import { describe, it, expect } from "vitest";
import { estimateTokens, chunkText } from "./chunking";

describe("estimateTokens", () => {
  it("estimates roughly 4 characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up for a partial token", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("chunkText", () => {
  it("returns a single chunk for text under the limit", () => {
    const text = "paragraph one\n\nparagraph two";
    expect(chunkText(text, 1000)).toEqual([text]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunkText("", 1000)).toEqual([]);
  });

  it("splits on paragraph boundaries once the running chunk exceeds the limit", () => {
    // Each paragraph is ~25 chars (~7 tokens); combining any two exceeds a
    // 10-token limit (52 chars, ~13 tokens), so each lands in its own
    // chunk — pinned down exactly rather than just checking content
    // survives somewhere, so a bug that merged or split differently would
    // actually fail this.
    const paragraphs = ["a".repeat(25), "b".repeat(25), "c".repeat(25)];
    const chunks = chunkText(paragraphs.join("\n\n"), 10);
    expect(chunks).toEqual(paragraphs);
  });

  it("packs multiple paragraphs into one chunk when they fit together under the limit", () => {
    const paragraphs = ["a".repeat(10), "b".repeat(10), "c".repeat(10)];
    // ~3 tokens each; three together (~30 chars, ~8 tokens) still fit under 10.
    const chunks = chunkText(paragraphs.join("\n\n"), 10);
    expect(chunks).toEqual([paragraphs.join("\n\n")]);
  });

  it("subdivides a single paragraph that alone exceeds maxTokensPerChunk, rather than passing it through whole", () => {
    // Extracted PDF text sometimes has no blank lines at all — without this,
    // chunkText's paragraph-boundary splitting is a no-op and the entire
    // (possibly 100k+ token) text goes out in one ungapped call.
    const hugeParagraph = "x".repeat(10_000);
    const chunks = chunkText(hugeParagraph, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(10 * 4);
    expect(chunks.join("")).toBe(hugeParagraph);
  });

  it("still splits an oversized paragraph on its own paragraph boundaries when surrounded by normal ones", () => {
    const before = "a".repeat(20);
    const huge = "x".repeat(200);
    const after = "b".repeat(20);
    const chunks = chunkText([before, huge, after].join("\n\n"), 10);
    expect(chunks.join("")).toContain(before);
    expect(chunks.join("")).toContain(after);
    expect(chunks.some((c) => c.includes("x"))).toBe(true);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(10 * 4);
  });
});
