import { describe, it, expect } from "vitest";
import { computeScaledDimensions, preservesAlpha } from "./resizeImage";

// resizeImageToDataUrl/resizeImageForNote themselves need a real canvas +
// createImageBitmap, which jsdom doesn't implement and this app has no
// other reason to depend on a native canvas package for — this covers the
// pure geometry/format decisions extracted out of them instead.

describe("computeScaledDimensions", () => {
  it("never upscales a source smaller than the target box", () => {
    expect(computeScaledDimensions(200, 100, 1600, 500)).toEqual({ width: 200, height: 100 });
  });

  it("downscales preserving aspect ratio when width is the binding constraint", () => {
    // 3200x1000, capped at 1600x500 — both dimensions exactly at the cap
    // here, so either could be "the" binding constraint; scale is 0.5 either way.
    expect(computeScaledDimensions(3200, 1000, 1600, 500)).toEqual({ width: 1600, height: 500 });
  });

  it("downscales preserving aspect ratio when height is the binding constraint", () => {
    // A tall image capped by height, not width.
    expect(computeScaledDimensions(1000, 4000, 1600, 500)).toEqual({ width: 125, height: 500 });
  });

  it("downscales preserving aspect ratio when width is the binding constraint and height has slack", () => {
    expect(computeScaledDimensions(4000, 1000, 1600, 2000)).toEqual({ width: 1600, height: 400 });
  });

  it("rounds fractional pixel dimensions", () => {
    const { width, height } = computeScaledDimensions(999, 333, 500, 500);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });
});

describe("preservesAlpha", () => {
  it("returns true for alpha-capable formats", () => {
    expect(preservesAlpha("image/png")).toBe(true);
    expect(preservesAlpha("image/gif")).toBe(true);
    expect(preservesAlpha("image/webp")).toBe(true);
  });

  it("returns false for jpeg, which is already opaque", () => {
    expect(preservesAlpha("image/jpeg")).toBe(false);
  });

  it("returns false for an unrecognized mime type", () => {
    expect(preservesAlpha("image/bmp")).toBe(false);
  });
});
