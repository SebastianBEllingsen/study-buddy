import { describe, it, expect, vi, beforeEach } from "vitest";

// dataUrlImage.ts imports blobKeyFromUrl from ./blobStorage, which reads
// data/storage-config.json (in this repo, a real Supabase project's
// credentials) via resolveStorageConfig — mocked so these tests never
// touch that file. Needs a default return value before the dynamic
// import below, since blobStorage/index.ts calls it at module load too.
const resolveStorageConfig = vi.fn().mockReturnValue({ mode: "local" });
vi.mock("@/lib/db/config", () => ({ resolveStorageConfig }));

const {
  parseDataUrlImage,
  isValidCoverImage,
  isValidIconImage,
  isValidPageBackgroundImage,
  isValidNoteImage,
  MAX_COVER_IMAGE_LENGTH,
} = await import("./dataUrlImage");

beforeEach(() => {
  resolveStorageConfig.mockReset();
  resolveStorageConfig.mockReturnValue({ mode: "local" });
});

describe("parseDataUrlImage", () => {
  it("parses a well-formed data URL", () => {
    expect(parseDataUrlImage("data:image/png;base64,AAAA")).toEqual({
      mimeType: "image/png",
      base64: "AAAA",
    });
  });

  it("preserves the exact mime type given", () => {
    expect(parseDataUrlImage("data:image/jpeg;base64,BBBB")?.mimeType).toBe("image/jpeg");
  });

  it("returns null for a non-string value", () => {
    expect(parseDataUrlImage(undefined)).toBeNull();
    expect(parseDataUrlImage(null)).toBeNull();
    expect(parseDataUrlImage(42)).toBeNull();
    expect(parseDataUrlImage({})).toBeNull();
  });

  it("returns null for a plain (non-data) URL", () => {
    expect(parseDataUrlImage("https://example.com/pic.png")).toBeNull();
  });

  it("returns null for a data URL missing the base64 marker", () => {
    expect(parseDataUrlImage("data:image/png,AAAA")).toBeNull();
  });

  it("returns null for a string over the max length, even if otherwise well-formed", () => {
    const huge = `data:image/png;base64,${"A".repeat(8_000_000)}`;
    expect(parseDataUrlImage(huge)).toBeNull();
  });

  it("accepts a string right at the max length boundary", () => {
    const prefix = "data:image/png;base64,";
    const exact = prefix + "A".repeat(8_000_000 - prefix.length);
    expect(exact.length).toBe(8_000_000);
    expect(parseDataUrlImage(exact)).not.toBeNull();
  });
});

// isValidCoverImage/isValidIconImage/isValidPageBackgroundImage/
// isValidNoteImage all share the same two-branch shape (a size-capped
// data:image/ URL, or one of this app's own blob URLs) — exercised once
// thoroughly via isValidCoverImage, then just enough on the others to
// confirm each uses its own distinct size cap.
describe("isValidCoverImage", () => {
  it("accepts a data:image/ URL under the cover cap", () => {
    expect(isValidCoverImage("data:image/png;base64,AAAA")).toBe(true);
  });

  it("rejects a data:image/ URL over the cover cap", () => {
    const huge = `data:image/png;base64,${"A".repeat(MAX_COVER_IMAGE_LENGTH)}`;
    expect(isValidCoverImage(huge)).toBe(false);
  });

  it("rejects a non-image data: URL", () => {
    expect(isValidCoverImage("data:text/plain;base64,AAAA")).toBe(false);
  });

  it("accepts this app's own local blob URL", () => {
    expect(isValidCoverImage("/api/blobs/cover/abc123.png")).toBe(true);
  });

  it("accepts this app's own currently-configured Supabase Storage URL", () => {
    resolveStorageConfig.mockReturnValue({
      mode: "supabase",
      connectionString: "postgres://...",
      storageUrl: "https://project.supabase.co",
      storageBucket: "files",
    });
    expect(
      isValidCoverImage("https://project.supabase.co/storage/v1/object/public/files/cover/abc.png")
    ).toBe(true);
  });

  it("rejects an arbitrary external image URL — the SSRF/bypass case this guards against", () => {
    expect(isValidCoverImage("https://evil.example.com/tracker.png")).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(isValidCoverImage(null)).toBe(false);
    expect(isValidCoverImage(42)).toBe(false);
  });
});

describe("isValidIconImage / isValidPageBackgroundImage / isValidNoteImage size caps", () => {
  it("each accepts a small data:image/ URL", () => {
    const small = "data:image/png;base64,AAAA";
    expect(isValidIconImage(small)).toBe(true);
    expect(isValidPageBackgroundImage(small)).toBe(true);
    expect(isValidNoteImage(small)).toBe(true);
  });

  it("each rejects an external URL the same way isValidCoverImage does", () => {
    const external = "https://evil.example.com/tracker.png";
    expect(isValidIconImage(external)).toBe(false);
    expect(isValidPageBackgroundImage(external)).toBe(false);
    expect(isValidNoteImage(external)).toBe(false);
  });

  it("icon image is capped independently of the cover cap", () => {
    // Icon's cap (1.5MB) is smaller than cover's (2MB) — a payload between
    // the two should pass for cover but fail for icon.
    const midSize = `data:image/png;base64,${"A".repeat(1_800_000)}`;
    expect(isValidCoverImage(midSize)).toBe(true);
    expect(isValidIconImage(midSize)).toBe(false);
  });
});
