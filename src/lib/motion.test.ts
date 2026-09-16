// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { prefersReducedMotion } from "./motion";

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the media query matches", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns false when the media query doesn't match", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it("queries specifically for prefers-reduced-motion: reduce", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", matchMedia);
    prefersReducedMotion();
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("returns false (not throw) when matchMedia isn't supported at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
