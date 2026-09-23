import { describe, expect, it } from "vitest";
import { hasTransparentPixels, isStickerImageUrl, mayHaveTransparency } from "./imageTransparency";

describe("hasTransparentPixels", () => {
  it("is false when every pixel is fully opaque", () => {
    expect(hasTransparentPixels(new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 255]))).toBe(false);
  });

  it("finds a single see-through or partly see-through pixel", () => {
    expect(hasTransparentPixels(new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]))).toBe(true);
    expect(hasTransparentPixels(new Uint8ClampedArray([255, 255, 255, 254]))).toBe(true);
  });

  it("only reads the alpha channel", () => {
    expect(hasTransparentPixels(new Uint8ClampedArray([0, 0, 0, 255]))).toBe(false);
  });
});

describe("mayHaveTransparency", () => {
  it("knows which formats can be see-through", () => {
    for (const type of ["image/png", "image/webp", "image/gif", "image/avif"]) expect(mayHaveTransparency(type)).toBe(true);
    expect(mayHaveTransparency("image/jpeg")).toBe(false);
    expect(mayHaveTransparency("")).toBe(false);
  });
});

describe("isStickerImageUrl", () => {
  it("treats PNG backdrops as stickers, wherever they're stored", () => {
    expect(isStickerImageUrl("https://x.supabase.co/storage/v1/object/public/files/background/abc.png")).toBe(true);
    expect(isStickerImageUrl("/api/blobs/background/abc.PNG")).toBe(true);
    expect(isStickerImageUrl("/api/blobs/background/abc.png?v=2")).toBe(true);
    expect(isStickerImageUrl("data:image/png;base64,AAAA")).toBe(true);
  });

  it("leaves photos, animations and nothing alone", () => {
    expect(isStickerImageUrl("https://x.supabase.co/files/background/abc.jpg")).toBe(false);
    expect(isStickerImageUrl("/api/blobs/background/abc.webp")).toBe(false);
    expect(isStickerImageUrl("/api/blobs/background/abc.gif")).toBe(false);
    expect(isStickerImageUrl("data:image/jpeg;base64,AAAA")).toBe(false);
    expect(isStickerImageUrl(null)).toBe(false);
  });
});
