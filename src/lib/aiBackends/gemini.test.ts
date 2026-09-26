import { describe, it, expect, vi } from "vitest";
import { ApiError } from "@google/genai";

// gemini.ts imports getProviderKey from ../models — see
// anthropicApi.test.ts's comment for why this must be mocked before import.
vi.mock("../models", () => ({ getProviderKey: vi.fn() }));

const { describeError } = await import("./gemini");

describe("gemini describeError", () => {
  it("gives a specific message for a 401 status", () => {
    const err = new ApiError({ message: "unauthorized", status: 401 });
    expect(describeError(err)).toMatch(/rejected the API key/i);
  });

  it("gives a specific message for a 403 status", () => {
    const err = new ApiError({ message: "forbidden", status: 403 });
    expect(describeError(err)).toMatch(/rejected the API key/i);
  });

  it("gives the API-key message for a 400 whose text says API_KEY_INVALID, even though the status isn't 401/403", () => {
    const err = new ApiError({ message: "API_KEY_INVALID: bad key", status: 400 });
    expect(describeError(err)).toMatch(/rejected the API key/i);
  });

  it("gives a specific message for a 429 status", () => {
    const err = new ApiError({ message: "rate limited", status: 429 });
    expect(describeError(err)).toMatch(/rate limited/i);
  });

  it("gives a generic API-error message with the status for anything else", () => {
    const err = new ApiError({ message: "server error", status: 500 });
    expect(describeError(err)).toContain("500");
  });

  it("falls back to the plain message for a non-SDK Error", () => {
    expect(describeError(new Error("something else broke"))).toBe("something else broke");
  });

  it("falls back to a generic message for a non-Error value", () => {
    expect(describeError("a string, not an Error")).toBe("Generation failed.");
  });
});

describe("gemini generateTextWithWebSearch", () => {
  it("turns on Google Search grounding without JSON mode and reports grounding URLs", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"resources":[]}',
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://redirect.example/abc", title: "example.org" } }, {}],
          },
        },
      ],
    });
    vi.resetModules();
    vi.doMock("@google/genai", async () => {
      const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
      return {
        ...actual,
        GoogleGenAI: class {
          models = { generateContent };
        },
      };
    });
    vi.doMock("../models", () => ({ getProviderKey: vi.fn(async () => "test-key") }));
    const { generateTextWithWebSearch } = await import("./gemini");

    const result = await generateTextWithWebSearch({ system: "s", user: "u" });
    const config = generateContent.mock.calls[0][0].config;
    expect(config.tools).toEqual([{ googleSearch: {} }]);
    expect(config.responseMimeType).toBeUndefined();
    expect(result).toEqual({
      text: '{"resources":[]}',
      citations: [{ url: "https://redirect.example/abc", title: "example.org" }],
      searched: true,
    });
  });
});
