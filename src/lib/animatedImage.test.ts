import { describe, it, expect } from "vitest";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { gifDelayMs, gifFrameCount, gifRepeat, isAnimatedImage } from "./animatedImage";

// Real GIFs, built with the same encoder the app uses to write cropped
// animations — so these exercise genuine block layouts (global palette,
// graphic control + NETSCAPE extensions, LZW sub-blocks), not a hand-rolled
// approximation of one.
// Each frame gets its own palette: gifenc writes the first as the global
// color table and every later one as a local table, so multi-frame GIFs
// here also exercise skipping local tables.
function makeGif(frameCount: number): Uint8Array {
  const gif = GIFEncoder();
  const w = 4;
  const h = 4;
  for (let f = 0; f < frameCount; f++) {
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37 + f * 91) % 256));
    const palette = quantize(rgba, 16);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, { palette, delay: 100 });
  }
  gif.finish();
  return gif.bytes();
}

function bytesOf(...parts: (string | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const c of part) out.push(c.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array(out);
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

function pngChunk(type: string, data: number[]): (string | number[])[] {
  return [u32(data.length), type, data, [0, 0, 0, 0]];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = pngChunk("IHDR", [...u32(1), ...u32(1), 8, 6, 0, 0, 0]);

function webp(flags: number): Uint8Array {
  const vp8x = [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return bytesOf("RIFF", u32le(4 + 8 + vp8x.length), "WEBP", "VP8X", u32le(vp8x.length), vp8x);
}

describe("isAnimatedImage", () => {
  it("tells animated GIFs from single-frame ones", () => {
    expect(isAnimatedImage(makeGif(1), "image/gif")).toBe(false);
    expect(isAnimatedImage(makeGif(3), "image/gif")).toBe(true);
  });

  it("counts every frame of a GIF, including ones with local palettes", () => {
    expect(gifFrameCount(makeGif(5))).toBe(5);
  });

  it("reads WebP's animation flag", () => {
    expect(isAnimatedImage(webp(0x02), "image/webp")).toBe(true);
    expect(isAnimatedImage(webp(0x10), "image/webp")).toBe(false); // alpha flag only
    expect(isAnimatedImage(bytesOf("RIFF", u32le(4), "WEBP", "VP8 "), "image/webp")).toBe(false);
  });

  it("recognizes APNG by an acTL chunk before the image data", () => {
    const apng = bytesOf(PNG_SIGNATURE, ...IHDR, ...pngChunk("acTL", [...u32(12), ...u32(0)]), ...pngChunk("IDAT", []));
    const oneFrameApng = bytesOf(PNG_SIGNATURE, ...IHDR, ...pngChunk("acTL", [...u32(1), ...u32(0)]), ...pngChunk("IDAT", []));
    const plainPng = bytesOf(PNG_SIGNATURE, ...IHDR, ...pngChunk("IDAT", []), ...pngChunk("IEND", []));
    expect(isAnimatedImage(apng, "image/png")).toBe(true);
    expect(isAnimatedImage(oneFrameApng, "image/png")).toBe(false);
    expect(isAnimatedImage(plainPng, "image/png")).toBe(false);
  });

  it("never treats JPEG, mislabeled, or truncated files as animated", () => {
    expect(isAnimatedImage(makeGif(3), "image/jpeg")).toBe(false);
    expect(isAnimatedImage(makeGif(3), "image/png")).toBe(false);
    expect(isAnimatedImage(makeGif(3).subarray(0, 20), "image/gif")).toBe(false);
    expect(isAnimatedImage(new Uint8Array(), "image/gif")).toBe(false);
  });
});

describe("gifDelayMs", () => {
  it("converts decoder durations (µs) to GIF-representable milliseconds", () => {
    expect(gifDelayMs(40_000)).toBe(40);
    expect(gifDelayMs(33_333)).toBe(30);
  });

  it("matches browsers, which play near-zero delays at 100ms", () => {
    expect(gifDelayMs(0)).toBe(100);
    expect(gifDelayMs(10_000)).toBe(100);
    expect(gifDelayMs(null)).toBe(100);
  });
});

describe("gifRepeat", () => {
  it("maps ImageDecoder's repetition count onto GIF's loop field", () => {
    expect(gifRepeat(Infinity)).toBe(0);
    expect(gifRepeat(2)).toBe(2);
  });
});
