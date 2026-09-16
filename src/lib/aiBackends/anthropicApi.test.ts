import { describe, it, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

// anthropicApi.ts imports getProviderKey from ../models, which imports
// ../db — whose module load connects to whatever backend
// data/storage-config.json currently points at (a real Supabase project in
// this repo). describeError below never touches it, but merely importing
// this file would. Mocked here so that never happens.
vi.mock("../models", () => ({ getProviderKey: vi.fn() }));

const { describeError } = await import("./anthropicApi");

describe("anthropicApi describeError", () => {
  it("gives a specific message for an authentication error", () => {
    const err = new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers());
    expect(describeError(err)).toMatch(/rejected the API key/i);
  });

  it("gives a specific message for a permission-denied (low credit) error", () => {
    const err = new Anthropic.PermissionDeniedError(403, undefined, "no credit", new Headers());
    expect(describeError(err)).toMatch(/credit balance/i);
  });

  it("gives a specific message for a rate-limit error", () => {
    const err = new Anthropic.RateLimitError(429, undefined, "slow down", new Headers());
    expect(describeError(err)).toMatch(/rate limited/i);
  });

  it("surfaces the nested error message from a bad-request error when present", () => {
    const err = new Anthropic.BadRequestError(
      400,
      { error: { message: "credit balance too low" } },
      "bad request",
      new Headers()
    );
    expect(describeError(err)).toBe("credit balance too low");
  });

  it("falls back to a generic message for a bad-request error with no nested message", () => {
    const err = new Anthropic.BadRequestError(400, {}, "bad request", new Headers());
    expect(describeError(err)).toMatch(/rejected/i);
  });

  it("gives a generic API-error message with the status code for other API errors", () => {
    const err = new Anthropic.NotFoundError(404, undefined, "not found", new Headers());
    expect(describeError(err)).toContain("404");
  });

  it("falls back to the plain message for a non-SDK Error", () => {
    expect(describeError(new Error("something else broke"))).toBe("something else broke");
  });

  it("falls back to a generic message for a non-Error value", () => {
    expect(describeError("a string, not an Error")).toBe("Generation failed.");
  });
});
