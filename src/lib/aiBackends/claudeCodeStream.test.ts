import { describe, expect, it, vi } from "vitest";

const getAppSettings = vi.fn().mockResolvedValue({ cliTrustedModeEnabled: false });
vi.mock("../models", () => ({ getAppSettings: (...args: unknown[]) => getAppSettings(...args) }));
vi.mock("./cliWorkspace", () => ({ materializeCliWorkspace: vi.fn() }));

const runCli = vi.fn();
vi.mock("./cliRunner", async () => {
  const actual = await vi.importActual<typeof import("./cliRunner")>("./cliRunner");
  return { ...actual, runCli: (...args: unknown[]) => runCli(...args) };
});

const { lastStreamResult, streamText, textDeltaFromStreamLine } = await import("./claudeCode");

describe("streamText", () => {
  it("forwards text deltas, even when a line is split across chunks", async () => {
    const delta = (text: string) =>
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } },
      });
    const result = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hello world" });
    const full = `${delta("Hello")}\n${delta(" world")}\n${result}\n`;
    runCli.mockImplementation(async (params: { onStdout: (c: string) => void; args: string[] }) => {
      expect(params.args).toContain("stream-json");
      const cut = full.indexOf("world") + 2;
      params.onStdout(full.slice(0, cut));
      params.onStdout(full.slice(cut));
      return { stdout: full, stderr: "" };
    });
    const deltas: string[] = [];

    const text = await streamText({ system: "s", user: "u" }, (d) => deltas.push(d));

    expect(deltas).toEqual(["Hello", " world"]);
    expect(text).toBe("Hello world");
  });
});

describe("textDeltaFromStreamLine", () => {
  it("extracts text deltas only", () => {
    const text = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hi" } },
    });
    const thinking = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
    });
    expect(textDeltaFromStreamLine(text)).toBe("Hi");
    expect(textDeltaFromStreamLine(thinking)).toBe("");
    expect(textDeltaFromStreamLine('{"type":"system"}')).toBe("");
    expect(textDeltaFromStreamLine("garbage")).toBe("");
    expect(textDeltaFromStreamLine('{"type":"stream_ev')).toBe("");
  });
});

describe("lastStreamResult", () => {
  it("finds the result event", () => {
    const out = ['{"type":"system"}', '{"type":"result","subtype":"success","is_error":false,"result":"Hello"}', ""].join("\n");
    expect(lastStreamResult(out).result).toBe("Hello");
  });
  it("throws without one", () => {
    expect(() => lastStreamResult('{"type":"system"}\n')).toThrow(/without a result/);
  });
});
