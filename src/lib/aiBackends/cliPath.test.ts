import { describe, it, expect } from "vitest";
import { commonCliDirs, withCommonCliDirs } from "./cliPath";

const HOME = "/home/user";
const NODE_BIN = "/opt/node/bin";

describe("withCommonCliDirs", () => {
  it("appends per-user install dirs after the existing PATH, which keeps priority", () => {
    const env = withCommonCliDirs({ PATH: "/usr/bin:/bin" }, "linux", HOME, NODE_BIN);
    const dirs = env.PATH!.split(":");
    expect(dirs.slice(0, 2)).toEqual(["/usr/bin", "/bin"]);
    expect(dirs).toContain("/home/user/.local/bin");
    expect(dirs).toContain(NODE_BIN);
  });

  it("doesn't repeat a dir that's already on PATH (trailing slash ignored)", () => {
    const env = withCommonCliDirs({ PATH: "/home/user/.local/bin/:/usr/bin" }, "linux", HOME, NODE_BIN);
    const dirs = env.PATH!.split(":");
    expect(dirs.filter((d) => d.replace(/\/$/, "") === "/home/user/.local/bin")).toHaveLength(1);
  });

  it("works when PATH is missing entirely", () => {
    const env = withCommonCliDirs({}, "linux", HOME, NODE_BIN);
    expect(env.PATH!.split(":")[0]).toBe("/home/user/.local/bin");
  });

  it("leaves other env vars untouched and doesn't mutate the input", () => {
    const input = { PATH: "/usr/bin", FOO: "bar" };
    const env = withCommonCliDirs(input, "linux", HOME, NODE_BIN);
    expect(env.FOO).toBe("bar");
    expect(input.PATH).toBe("/usr/bin");
  });

  it("on Windows, reuses the existing Path key's casing and ; delimiter, deduping case-insensitively", () => {
    const home = "C:\\Users\\user";
    const env = withCommonCliDirs(
      { Path: "C:\\Windows;c:\\users\\user\\.local\\bin", APPDATA: "C:\\Users\\user\\AppData\\Roaming" },
      "win32",
      home,
      "C:\\Program Files\\nodejs"
    );
    expect(env.PATH).toBeUndefined();
    const dirs = env.Path!.split(";");
    expect(dirs[0]).toBe("C:\\Windows");
    expect(dirs.filter((d) => d.toLowerCase() === "c:\\users\\user\\.local\\bin")).toHaveLength(1);
    expect(dirs).toContain("C:\\Users\\user\\AppData\\Roaming\\npm");
  });
});

describe("commonCliDirs", () => {
  it("includes Homebrew only on macOS", () => {
    expect(commonCliDirs("darwin", HOME, {}, NODE_BIN)).toContain("/opt/homebrew/bin");
    expect(commonCliDirs("linux", HOME, {}, NODE_BIN)).not.toContain("/opt/homebrew/bin");
  });

  it("prefers PNPM_HOME when set", () => {
    expect(commonCliDirs("linux", HOME, { PNPM_HOME: "/custom/pnpm" }, NODE_BIN)).toContain("/custom/pnpm");
  });
});
