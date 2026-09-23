import { describe, expect, it } from "vitest";
import { MAX_BACKDROP_BLUR, backdropBlurStyle, clampBackdropBlur } from "./backdropBlur";

describe("clampBackdropBlur", () => {
  it("keeps in-range values, rounded", () => {
    expect(clampBackdropBlur(0)).toBe(0);
    expect(clampBackdropBlur(7.6)).toBe(8);
  });

  it("clamps out-of-range and non-finite values", () => {
    expect(clampBackdropBlur(-3)).toBe(0);
    expect(clampBackdropBlur(500)).toBe(MAX_BACKDROP_BLUR);
    expect(clampBackdropBlur(Number.NaN)).toBe(0);
  });
});

describe("backdropBlurStyle", () => {
  it("adds nothing without blur", () => {
    expect(backdropBlurStyle(0)).toEqual({});
  });

  it("blurs and scales up to hide the soft edge", () => {
    expect(backdropBlurStyle(10)).toEqual({ filter: "blur(10px)", transform: "scale(1.08)" });
  });
});
