import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  kill = vi.fn();
}

let fakeChild: FakeChildProcess;
const spawn = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawn(...args) }));

const { runCli } = await import("./cliRunner");

function baseParams(overrides: Partial<Parameters<typeof runCli>[0]> = {}) {
  return {
    command: "fake-cli",
    args: [],
    stdin: "hello",
    cwd: "/tmp",
    env: process.env,
    timeoutMs: 5000,
    maxBufferBytes: 1_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  fakeChild = new FakeChildProcess();
  spawn.mockReset().mockReturnValue(fakeChild);
});

describe("runCli", () => {
  it("spawns with a PATH widened to the common per-user CLI install dirs", () => {
    void runCli(baseParams({ env: { ...process.env, PATH: "/usr/bin" } }));
    const options = spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    const pathKey = Object.keys(options.env).find((k) => k.toUpperCase() === "PATH")!;
    const dirs = options.env[pathKey]!.split(process.platform === "win32" ? ";" : ":");
    expect(dirs[0]).toBe("/usr/bin");
    expect(dirs.length).toBeGreaterThan(1);
    fakeChild.emit("close", 0);
  });

  it("resolves with stdout/stderr on a clean exit", async () => {
    const promise = runCli(baseParams());
    fakeChild.stdout.emit("data", Buffer.from("out"));
    fakeChild.stderr.emit("data", Buffer.from("err"));
    fakeChild.emit("close", 0);
    await expect(promise).resolves.toEqual({ stdout: "out", stderr: "err" });
  });

  it("rejects with CliNotFoundError on ENOENT", async () => {
    const promise = runCli(baseParams());
    const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    fakeChild.emit("error", err);
    await expect(promise).rejects.toThrow(/isn't on PATH/);
  });

  // Regression coverage: child.stdin is a separate stream from the child
  // process object — an 'error' event emitted on it (e.g. the spawn itself
  // failing, or the child exiting before consuming a large prompt, either
  // of which can leave this pipe destroyed/closed) had no listener, and an
  // EventEmitter with no 'error' listener throws synchronously when one
  // fires — this would have crashed the whole process, not just rejected
  // this promise. Node's EventEmitter throwing here is exactly what
  // proves the regression: without a stdin 'error' listener in cliRunner.ts,
  // this test itself would throw instead of the promise settling.
  it("does not crash when child.stdin emits an error", async () => {
    const promise = runCli(baseParams());
    expect(() => fakeChild.stdin.emit("error", new Error("EPIPE"))).not.toThrow();
    // The run still settles via the normal close/error handlers — the
    // stdin error listener only needs to swallow the stream-level event,
    // not itself resolve/reject the call.
    fakeChild.emit("close", 0);
    await expect(promise).resolves.toEqual({ stdout: "", stderr: "" });
  });
});
