import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

class FakeChildProcess extends EventEmitter {}
let fakeChild: FakeChildProcess;
const spawn = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawn(...args) }));

const mkdtemp = vi.fn();
const writeFile = vi.fn().mockResolvedValue(undefined);
const readFile = vi.fn().mockResolvedValue(Buffer.from("pdf bytes"));
const rm = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({
  default: {
    mkdtemp: (...args: unknown[]) => mkdtemp(...args),
    writeFile: (...args: unknown[]) => writeFile(...args),
    readFile: (...args: unknown[]) => readFile(...args),
    rm: (...args: unknown[]) => rm(...args),
  },
}));

const { convertToPdf } = await import("./libreoffice");

beforeEach(() => {
  fakeChild = new FakeChildProcess();
  spawn.mockReset().mockReturnValue(fakeChild);
  writeFile.mockClear();
  readFile.mockClear();
  rm.mockClear();
});

describe("convertToPdf", () => {
  // Regression coverage: a plain `file://${profileDir}` template string
  // doesn't percent-encode spaces or non-ASCII characters — os.tmpdir()
  // can contain either (a macOS username with a space in it, a
  // Windows/Linux username with non-ASCII characters), producing a
  // malformed file URL that made LibreOffice silently fall back to the
  // shared default profile, reintroducing the lock contention under
  // concurrent conversions -env:UserInstallation exists to avoid.
  it("percent-encodes a space in the temp directory path in the UserInstallation URL", async () => {
    mkdtemp.mockResolvedValue("/tmp/a folder with spaces/sb-libreoffice-xyz");

    const promise = convertToPdf(Buffer.from("doc bytes"), "odt");
    // convertToPdf awaits fs.mkdtemp/writeFile before calling spawn() — let
    // those microtasks settle before the fake child "exits".
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    fakeChild.emit("exit", 0);
    await promise;

    const args = spawn.mock.calls[0][1] as string[];
    const userInstallationArg = args.find((a) => a.startsWith("-env:UserInstallation="));
    expect(userInstallationArg).toBeDefined();
    const url = userInstallationArg!.slice("-env:UserInstallation=".length);
    expect(url).not.toContain(" "); // the raw, unescaped space must never appear
    expect(url).toContain("%20");
    // And it must still be a valid, parseable URL — the actual bug wasn't
    // just cosmetic, it made LibreOffice unable to use the profile dir at all.
    expect(() => new URL(url)).not.toThrow();
  });

  it("rejects with LibreOfficeUnavailableError when soffice isn't installed (ENOENT)", async () => {
    mkdtemp.mockResolvedValue("/tmp/sb-libreoffice-xyz");
    const promise = convertToPdf(Buffer.from("doc bytes"), "odt");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    fakeChild.emit("error", err);
    await expect(promise).rejects.toThrow(/isn't installed/);
  });

  it("cleans up the work directory even when conversion fails", async () => {
    mkdtemp.mockResolvedValue("/tmp/sb-libreoffice-xyz");
    const promise = convertToPdf(Buffer.from("doc bytes"), "odt");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    fakeChild.emit("exit", 1);
    await expect(promise).rejects.toThrow();
    expect(rm).toHaveBeenCalledWith("/tmp/sb-libreoffice-xyz", { recursive: true, force: true });
  });
});
