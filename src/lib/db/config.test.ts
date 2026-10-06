import { describe, it, expect, vi, beforeEach } from "vitest";

// config.ts reads/writes data/storage-config.json via node:fs directly,
// with no injection point to redirect it — in this repo that file holds a
// real Supabase project's live credentials. node:fs is mocked in its
// entirety here so these tests can never read or write that file, or any
// file, for real.
const readFileSync = vi.fn();
const writeFileSync = vi.fn();
const existsSync = vi.fn();
const mkdirSync = vi.fn();
const chmodSync = vi.fn();
vi.mock("node:fs", () => ({
  default: { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync },
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
}));

const { resolveStorageConfig, supabaseDetails, writeStorageConfig } = await import("./config");

const ENV_KEYS = ["DATABASE_URL", "SUPABASE_STORAGE_URL", "SUPABASE_STORAGE_SERVICE_KEY", "SUPABASE_STORAGE_BUCKET"];

beforeEach(() => {
  readFileSync.mockReset();
  writeFileSync.mockReset();
  existsSync.mockReset();
  mkdirSync.mockReset();
  chmodSync.mockReset();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("resolveStorageConfig", () => {
  it("prefers DATABASE_URL over the config file when set", () => {
    process.env.DATABASE_URL = "postgres://env-wins";
    process.env.SUPABASE_STORAGE_URL = "https://env.supabase.co";
    process.env.SUPABASE_STORAGE_SERVICE_KEY = "env-key";
    process.env.SUPABASE_STORAGE_BUCKET = "env-bucket";

    const config = resolveStorageConfig();
    expect(config).toEqual({
      mode: "supabase",
      connectionString: "postgres://env-wins",
      storageUrl: "https://env.supabase.co",
      storageServiceKey: "env-key",
      storageBucket: "env-bucket",
    });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("reads a valid supabase config from the file when no DATABASE_URL is set", () => {
    readFileSync.mockReturnValue(
      JSON.stringify({ mode: "supabase", connectionString: "postgres://from-file" })
    );
    expect(resolveStorageConfig()).toEqual({
      mode: "supabase",
      connectionString: "postgres://from-file",
    });
  });

  it("falls back to local when the file says local", () => {
    readFileSync.mockReturnValue(JSON.stringify({ mode: "local" }));
    expect(resolveStorageConfig()).toEqual({ mode: "local" });
  });

  it("falls back to local when the file's supabase config is missing a connectionString", () => {
    readFileSync.mockReturnValue(JSON.stringify({ mode: "supabase" }));
    expect(resolveStorageConfig()).toEqual({ mode: "local" });
  });

  it("falls back to local when the file doesn't exist (read throws)", () => {
    readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    expect(resolveStorageConfig()).toEqual({ mode: "local" });
  });

  it("falls back to local when the file contains malformed JSON", () => {
    readFileSync.mockReturnValue("{not valid json");
    expect(resolveStorageConfig()).toEqual({ mode: "local" });
  });
});

describe("writeStorageConfig", () => {
  it("creates the data directory first when it doesn't exist yet", () => {
    existsSync.mockReturnValue(false);
    writeStorageConfig({ mode: "local" });
    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining("data"), { recursive: true });
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("skips creating the data directory when it already exists", () => {
    existsSync.mockReturnValue(true);
    writeStorageConfig({ mode: "local" });
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it("writes the config as pretty-printed JSON to storage-config.json", () => {
    existsSync.mockReturnValue(true);
    const config = { mode: "supabase" as const, connectionString: "postgres://x" };
    writeStorageConfig(config);

    const [writtenPath, writtenContent] = writeFileSync.mock.calls[0];
    expect(writtenPath).toMatch(/data[/\\]storage-config\.json$/);
    expect(JSON.parse(writtenContent)).toEqual(config);
    expect(writtenContent).toBe(JSON.stringify(config, null, 2));
  });

  it("keeps the file private to this user, including one an older version made world-readable", () => {
    existsSync.mockReturnValue(true);
    writeStorageConfig({ mode: "local" });
    expect(writeFileSync.mock.calls[0][2]).toEqual({ mode: 0o600 });
    expect(chmodSync).toHaveBeenCalledWith(expect.stringMatching(/storage-config\.json$/), 0o600);
  });

  it("still succeeds when the file system can't change modes", () => {
    existsSync.mockReturnValue(true);
    chmodSync.mockImplementation(() => {
      throw new Error("EPERM");
    });
    expect(() => writeStorageConfig({ mode: "local" })).not.toThrow();
  });
});

describe("remembered Supabase details", () => {
  const details = { connectionString: "postgres://x", storageUrl: "https://p.supabase.co", storageServiceKey: "k", storageBucket: "b" };

  it("reads them from a Supabase config, sync or not", () => {
    expect(supabaseDetails({ mode: "supabase", sync: true, ...details })).toEqual(details);
  });

  it("keeps them while on local, so switching back needs nothing re-entered", () => {
    readFileSync.mockReturnValue(JSON.stringify({ mode: "local", remembered: details }));
    const config = resolveStorageConfig();
    expect(config.mode).toBe("local");
    expect(supabaseDetails(config)).toEqual(details);
    expect(supabaseDetails({ mode: "local" })).toBeNull();
  });
});
