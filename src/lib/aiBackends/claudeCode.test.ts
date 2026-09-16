import { describe, it, expect } from "vitest";
import { CliNotFoundError, CliTimeoutError } from "./cliRunner";
import { describeError } from "./claudeCode";

describe("claudeCode describeError", () => {
  it("gives a specific message when the CLI isn't installed", () => {
    expect(describeError(new CliNotFoundError())).toMatch(/isn't on PATH/i);
  });

  it("gives a specific message on timeout", () => {
    expect(describeError(new CliTimeoutError())).toMatch(/took too long/i);
  });

  it("gives a specific message when the CLI isn't logged in", () => {
    expect(describeError(new Error("Not logged in to Claude"))).toMatch(/isn't logged in/i);
  });

  it("falls back to the plain message for any other Error", () => {
    expect(describeError(new Error("some other failure"))).toBe("some other failure");
  });

  it("falls back to a generic message for a non-Error value", () => {
    expect(describeError("a string, not an Error")).toBe("Generation via Claude Code failed.");
  });
});
