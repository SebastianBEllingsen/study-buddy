import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import { CliNotFoundError, CliTimeoutError } from "./cliRunner";

const getAppSettings = vi.fn();
vi.mock("../models", () => ({ getAppSettings: (...args: unknown[]) => getAppSettings(...args) }));

const materializeCliWorkspace = vi.fn();
vi.mock("./cliWorkspace", () => ({
  materializeCliWorkspace: (...args: unknown[]) => materializeCliWorkspace(...args),
}));

const runCli = vi.fn();
vi.mock("./cliRunner", async () => {
  const actual = await vi.importActual<typeof import("./cliRunner")>("./cliRunner");
  return { ...actual, runCli: (...args: unknown[]) => runCli(...args) };
});

const { describeError, generateText } = await import("./claudeCode");

function claudeResult(overrides: Partial<{ is_error: boolean; result: string }> = {}) {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "an answer",
    total_cost_usd: 0,
    ...overrides,
  });
}

beforeEach(() => {
  getAppSettings.mockReset();
  materializeCliWorkspace.mockReset();
  runCli.mockReset().mockResolvedValue({ stdout: claudeResult(), stderr: "" });
});

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

describe("claudeCode trusted mode toggle", () => {
  it("off (default): still throws on images, never materializes a workspace, uses os.tmpdir()", async () => {
    getAppSettings.mockResolvedValue({ cliTrustedModeEnabled: false });

    await expect(
      generateText({ system: "sys", user: "hi", images: [{ base64: "abc", mimeType: "image/png" }] })
    ).rejects.toThrow(/Image input isn't supported/);
    expect(materializeCliWorkspace).not.toHaveBeenCalled();

    await generateText({ system: "sys", user: "hi" });
    expect(materializeCliWorkspace).not.toHaveBeenCalled();
    const [call] = runCli.mock.calls;
    expect(call[0].cwd).toBe(os.tmpdir());
    expect(call[0].args).toContain("--restricted");
    expect(call[0].args).toContain("--disallowedTools");
  });

  it("on + images: materializes a workspace instead of throwing, and cleans it up", async () => {
    getAppSettings.mockResolvedValue({ cliTrustedModeEnabled: true });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    materializeCliWorkspace.mockResolvedValue({
      dir: "/fake/workspace/dir",
      manifestPath: "/fake/workspace/dir/manifest.json",
      cleanup,
    });

    const reply = await generateText({
      system: "sys",
      user: "hi",
      images: [{ base64: "abc", mimeType: "image/png" }],
    });

    expect(reply).toBe("an answer");
    expect(materializeCliWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        inlineFiles: [{ filename: "image-1", base64: "abc", mimeType: "image/png" }],
      })
    );
    const [call] = runCli.mock.calls;
    expect(call[0].cwd).toBe("/fake/workspace/dir");
    expect(call[0].args).not.toContain("--restricted");
    expect(call[0].args).not.toContain("--disallowedTools");
    expect(call[0].args).toContain("--strict-mcp-config");
    expect(cleanup).toHaveBeenCalled();
  });

  it("on, but nothing to materialize: skips the workspace and uses os.tmpdir()", async () => {
    getAppSettings.mockResolvedValue({ cliTrustedModeEnabled: true });

    await generateText({ system: "sys", user: "hi" });

    expect(materializeCliWorkspace).not.toHaveBeenCalled();
    const [call] = runCli.mock.calls;
    expect(call[0].cwd).toBe(os.tmpdir());
  });
});
