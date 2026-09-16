import { describe, it, expect } from "vitest";
import { CliNotFoundError, CliTimeoutError } from "./cliRunner";
import { describeError } from "./codexCli";

describe("codexCli describeError", () => {
  it("gives a specific message when the CLI isn't installed", () => {
    expect(describeError(new CliNotFoundError())).toMatch(/isn't on PATH/i);
  });

  it("gives a specific message on timeout", () => {
    expect(describeError(new CliTimeoutError())).toMatch(/took too long/i);
  });

  it.each(["not logged in", "please log in", "authentication required"])(
    "gives a specific message for an auth-shaped error: %s",
    (message) => {
      expect(describeError(new Error(message))).toMatch(/isn't logged in/i);
    }
  );

  it("falls back to the plain message for any other Error", () => {
    expect(describeError(new Error("some other failure"))).toBe("some other failure");
  });

  it("falls back to a generic message for a non-Error value", () => {
    expect(describeError("a string, not an Error")).toBe("Generation via Codex failed.");
  });
});
