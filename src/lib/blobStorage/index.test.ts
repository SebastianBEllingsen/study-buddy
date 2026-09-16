import { describe, it, expect, vi, beforeEach } from "vitest";

// resolveStorageConfig reads data/storage-config.json off disk (in this
// repo, currently a real Supabase project's credentials) — mocked so these
// tests are deterministic and never read that file or depend on its
// contents. blobKeyFromUrl calls it fresh on every call, so the mock is
// reconfigured per test rather than fixed once at import time.
const resolveStorageConfig = vi.fn().mockReturnValue({ mode: "local" });
vi.mock("@/lib/db/config", () => ({ resolveStorageConfig }));

// index.ts calls resolve() (which calls resolveStorageConfig()) at module
// load to set up its `blobStore` binding — the mock above needs a return
// value in place *before* this import runs, not just before each test.
const { blobKeyFromUrl } = await import("./index");

beforeEach(() => {
  resolveStorageConfig.mockReset();
  resolveStorageConfig.mockReturnValue({ mode: "local" });
});

describe("blobKeyFromUrl", () => {
  it("recognizes a local blob URL regardless of the currently configured mode", () => {
    expect(blobKeyFromUrl("/api/blobs/icon/abc123.png")).toBe("icon/abc123.png");
  });

  it("recognizes a Supabase Storage public URL matching the current config", () => {
    resolveStorageConfig.mockReturnValue({
      mode: "supabase",
      connectionString: "postgres://...",
      storageUrl: "https://project.supabase.co",
      storageBucket: "files",
    });
    const url = "https://project.supabase.co/storage/v1/object/public/files/icon/abc123.png";
    expect(blobKeyFromUrl(url)).toBe("icon/abc123.png");
  });

  // Regression coverage: an earlier version only recognized a Supabase
  // Storage URL when it matched the *currently configured* storageUrl/
  // storageBucket. A course cover image saved while on Supabase stores that
  // URL permanently in the DB row — switching storage mode back to local
  // (or just renaming the bucket) doesn't change what's already stored
  // there, but it made every subsequent save of an unrelated field on that
  // same row fail image validation, since isImageUrl (dataUrlImage.ts)
  // relies on this function recognizing the stored value. blobKeyFromUrl is
  // only ever used for format validation and best-effort cleanup, never as
  // an access boundary, so staying bucket/config-independent here is safe.
  it("recognizes any Supabase Storage public URL shape regardless of the currently configured bucket", () => {
    resolveStorageConfig.mockReturnValue({
      mode: "supabase",
      connectionString: "postgres://...",
      storageUrl: "https://project.supabase.co",
      storageBucket: "files",
    });
    const otherBucketUrl = "https://project.supabase.co/storage/v1/object/public/other-bucket/icon/abc.png";
    expect(blobKeyFromUrl(otherBucketUrl)).toBe("icon/abc.png");
  });

  it("recognizes a Supabase Storage public URL even when currently in local mode", () => {
    resolveStorageConfig.mockReturnValue({ mode: "local" });
    const url = "https://project.supabase.co/storage/v1/object/public/files/icon/abc.png";
    expect(blobKeyFromUrl(url)).toBe("icon/abc.png");
  });

  it("returns null for a data: URL", () => {
    expect(blobKeyFromUrl("data:image/png;base64,AAAA")).toBeNull();
  });

  it("returns null for an arbitrary external URL", () => {
    expect(blobKeyFromUrl("https://example.com/pic.png")).toBeNull();
  });
});
