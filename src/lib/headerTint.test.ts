import { describe, expect, it } from "vitest";
import {
  backdropFractionUnderHeader,
  colorAtFraction,
  mix,
  parseHeaderTintMode,
  relativeLuminance,
  stripColors,
  textToneFor,
  wallpaperFractionUnderHeader,
} from "./headerTint";

// 2×3 image: a red row, a half-see-through blue/green row, a fully see-through row.
const rgba = new Uint8ClampedArray([
  255, 0, 0, 255, 255, 0, 0, 255,
  0, 0, 255, 255, 0, 255, 0, 0,
  9, 9, 9, 0, 9, 9, 9, 0,
]);

describe("stripColors", () => {
  it("averages each row, weighting by opacity", () => {
    expect(stripColors(rgba, 2, 3)).toEqual([[255, 0, 0], [0, 0, 255], null]);
  });
});

describe("colorAtFraction", () => {
  const strips = [[0, 0, 0], [200, 100, 0], null, [100, 100, 100]] as const;

  it("returns strip colors at their positions and blends in between", () => {
    expect(colorAtFraction([...strips], 0)).toEqual([0, 0, 0]);
    expect(colorAtFraction([...strips], 1 / 3)).toEqual([200, 100, 0]);
    expect(colorAtFraction([...strips], 1 / 6)).toEqual([100, 50, 0]);
  });

  it("skips see-through strips and clamps outside the picture", () => {
    expect(colorAtFraction([...strips], 2 / 3)).toEqual([150, 100, 50]);
    expect(colorAtFraction([...strips], 5)).toEqual([100, 100, 100]);
    expect(colorAtFraction([null, null], 0.5)).toBeNull();
  });
});

describe("contrast", () => {
  it("measures luminance", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1);
  });

  it("picks light text on dark colors and dark text on light ones", () => {
    expect(textToneFor([20, 20, 40])).toBe("light");
    expect(textToneFor([240, 230, 200])).toBe("dark");
    expect(textToneFor([255, 212, 0])).toBe("dark");
    expect(textToneFor([0, 0, 200])).toBe("light");
  });

  it("mixes colors", () => {
    expect(mix([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
  });
});

describe("where the header sits over the picture", () => {
  it("tracks a page backdrop as it scrolls up under the header", () => {
    expect(backdropFractionUnderHeader(60, 60, 300)).toBeLessThan(0); // just below the header
    expect(backdropFractionUnderHeader(60, -120, 300)).toBeCloseTo(0.5);
    expect(backdropFractionUnderHeader(60, -400, 300)).toBeGreaterThan(1); // scrolled past
  });

  it("finds the header's line on a cover-fitted wallpaper", () => {
    // A 2:1 picture in a 1000×1000 window is scaled to 2000×1000: no vertical crop.
    expect(wallpaperFractionUnderHeader(60, { width: 1000, height: 1000 }, { width: 200, height: 100 })).toBeCloseTo(0.03);
    // A square picture in a wide 2000×500 window is cropped top and bottom.
    expect(wallpaperFractionUnderHeader(0, { width: 2000, height: 500 }, { width: 100, height: 100 })).toBeCloseTo(0.375);
  });
});

describe("parseHeaderTintMode", () => {
  it("defaults to static", () => {
    expect(parseHeaderTintMode("adaptive-text")).toBe("adaptive-text");
    expect(parseHeaderTintMode(null)).toBe("static");
    expect(parseHeaderTintMode("rainbow")).toBe("static");
  });
});
