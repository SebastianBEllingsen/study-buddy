import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import { createOpenAiCompatibleBackend } from "./openaiCompatible";

// No ../models import in this file, so no DB-connection-chain risk — see
// anthropicApi.test.ts's comment for that concern elsewhere.

const backend = createOpenAiCompatibleBackend({
  apiKey: "test-key",
  model: "test-model",
  providerLabel: "TestProvider",
  keyHelpText: "get one at test.example.com",
});

describe("createOpenAiCompatibleBackend describeError", () => {
  it("includes the configured provider label in an authentication error message", () => {
    const err = new OpenAI.AuthenticationError(401, undefined, "bad key", new Headers());
    expect(backend.describeError(err)).toContain("TestProvider");
    expect(backend.describeError(err)).toMatch(/rejected the API key/i);
  });

  it("includes the configured provider label in a rate-limit error message", () => {
    const err = new OpenAI.RateLimitError(429, undefined, "slow down", new Headers());
    expect(backend.describeError(err)).toContain("TestProvider");
    expect(backend.describeError(err)).toMatch(/rate limited/i);
  });

  it("includes the configured provider label in a permission-denied error message", () => {
    const err = new OpenAI.PermissionDeniedError(403, undefined, "denied", new Headers());
    expect(backend.describeError(err)).toContain("TestProvider");
  });

  it("includes the provider label and status code for other API errors", () => {
    const err = new OpenAI.NotFoundError(404, undefined, "not found", new Headers());
    const message = backend.describeError(err);
    expect(message).toContain("TestProvider");
    expect(message).toContain("404");
  });

  it("a second backend instance with a different label produces a differently-labeled message", () => {
    const other = createOpenAiCompatibleBackend({
      apiKey: "k",
      model: "m",
      providerLabel: "OtherProvider",
      keyHelpText: "h",
    });
    const err = new OpenAI.AuthenticationError(401, undefined, "bad key", new Headers());
    expect(other.describeError(err)).toContain("OtherProvider");
    expect(other.describeError(err)).not.toContain("TestProvider");
  });

  it("falls back to the plain message for a non-SDK Error", () => {
    expect(backend.describeError(new Error("something else broke"))).toBe("something else broke");
  });

  it("falls back to a generic message for a non-Error value", () => {
    expect(backend.describeError("a string, not an Error")).toBe("Generation failed.");
  });
});
