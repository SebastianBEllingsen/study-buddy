import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The local cache would otherwise write into this repo's real data/blobs/.
const cache = new Map<string, Buffer>();
vi.mock("./local", () => ({
  localBlobStore: { kind: "local" },
  readLocalBlob: vi.fn(async (key: string) => cache.get(key) ?? null),
  writeLocalBlobCache: vi.fn(async (key: string, bytes: Buffer) => void cache.set(key, bytes)),
  removeLocalBlobCache: vi.fn(async (key: string) => void cache.delete(key)),
}));
const config = {
  mode: "supabase" as const,
  connectionString: "postgres://x",
  storageUrl: "https://project.supabase.co",
  storageServiceKey: "service-key",
  storageBucket: "files",
};
vi.mock("@/lib/db/config", () => ({ resolveStorageConfig: () => config }));

const { createSupabaseBlobStore } = await import("./supabase");
const { readBlob } = await import("./index");

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  cache.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Supabase blob store", () => {
  it("uploads, keeps a local copy, and hands back the app's own /api/blobs/ URL", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const store = createSupabaseBlobStore(config)!;
    const put = await store.put("documents/a.pdf", Buffer.from("%PDF"), "application/pdf");
    expect(put).toEqual({ url: "/api/blobs/documents/a.pdf" });
    expect(cache.get("documents/a.pdf")?.toString()).toBe("%PDF");
  });

  it("downloads with the service key, so private buckets work too", async () => {
    fetchMock.mockResolvedValue(new Response("bytes", { status: 200 }));
    const bytes = await createSupabaseBlobStore(config)!.get("documents/a.pdf");
    expect(bytes?.toString()).toBe("bytes");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/storage/v1/object/files/documents/a.pdf");
    expect(init.headers.Authorization).toBe("Bearer service-key");
  });
});

describe("readBlob", () => {
  it("serves this computer's copy, else downloads once and keeps it", async () => {
    fetchMock.mockResolvedValue(new Response("from cloud", { status: 200 }));
    expect((await readBlob("course/x.png"))?.toString()).toBe("from cloud");
    expect((await readBlob("course/x.png"))?.toString()).toBe("from cloud");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the file is gone everywhere", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await readBlob("course/missing.png")).toBeNull();
  });
});
