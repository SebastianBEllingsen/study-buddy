import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// local.ts writes real files under data/blobs relative to process.cwd() —
// mocked so these tests never touch this repo's actual data/ directory.
const mkdir = vi.fn().mockResolvedValue(undefined);
const writeFile = vi.fn().mockResolvedValue(undefined);
const rm = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: (...args: unknown[]) => mkdir(...args),
    writeFile: (...args: unknown[]) => writeFile(...args),
    rm: (...args: unknown[]) => rm(...args),
  },
}));

const { localBlobStore } = await import("./local");

const blobsDir = path.join(process.cwd(), "data", "blobs");

beforeEach(() => {
  mkdir.mockClear();
  writeFile.mockClear();
  rm.mockClear();
});

describe("localBlobStore", () => {
  it("put() writes under blobsDir for a normal server-generated key", async () => {
    const result = await localBlobStore.put("icon/abc123.png", Buffer.from([1, 2, 3]), "image/png");
    expect(result?.url).toBe("/api/blobs/icon/abc123.png");
    expect(writeFile).toHaveBeenCalledWith(path.join(blobsDir, "icon", "abc123.png"), expect.anything());
  });

  it("remove() deletes the same path put() would have written for that key", async () => {
    await localBlobStore.remove("icon/abc123.png");
    expect(rm).toHaveBeenCalledWith(path.join(blobsDir, "icon", "abc123.png"), { force: true });
  });

  // Regression coverage: remove()'s key can come from blobKeyFromUrl() on a
  // URL stored in a client-controlled DB field (e.g. a course's
  // cover_image) — see blobStorage/index.ts. A crafted stored URL like
  // "/api/blobs/../../../../some/file" used to reach fs.rm on an arbitrary
  // path once that field got replaced or cleaned up.
  it.each([
    ["../../../../etc/passwd"],
    ["../outside.txt"],
    ["a/../../../../escape.png"],
  ])("remove() rejects a traversal key %s instead of deleting outside blobsDir", async (key) => {
    await expect(localBlobStore.remove(key)).rejects.toThrow();
    expect(rm).not.toHaveBeenCalled();
  });

  it.each([["../../../../etc/passwd"], ["../outside.txt"]])(
    "put() rejects a traversal key %s instead of writing outside blobsDir",
    async (key) => {
      await expect(localBlobStore.put(key, Buffer.from([]), "image/png")).rejects.toThrow();
      expect(writeFile).not.toHaveBeenCalled();
    }
  );

  it("rejects an empty key", async () => {
    await expect(localBlobStore.remove("")).rejects.toThrow();
    expect(rm).not.toHaveBeenCalled();
  });
});
