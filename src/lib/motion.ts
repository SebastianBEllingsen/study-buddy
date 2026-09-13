"use client";

// The CSS `prefers-reduced-motion` rule in globals.css zeroes out
// transition/animation durations, but that only covers CSS transitions —
// it has no effect on JS-driven `scrollIntoView({ behavior: "smooth" })`
// calls, which need this explicit check instead.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
