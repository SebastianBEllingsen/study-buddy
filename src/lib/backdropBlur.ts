import type { CSSProperties } from "react";

// Blur on the dashboard backdrop (Settings → Branding → "Backdrop blur").
export const MAX_BACKDROP_BLUR = 24;

export function clampBackdropBlur(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_BACKDROP_BLUR, Math.max(0, Math.round(value)));
}

// Style for the element drawing the backdrop image. Scaled up slightly
// while blurred so the soft edge the blur leaves falls outside the
// (overflow-hidden) box instead of showing as a hazy border — same as
// AppWallpaper.
export function backdropBlurStyle(blur: number): CSSProperties {
  const px = clampBackdropBlur(blur);
  if (px === 0) return {};
  return { filter: `blur(${px}px)`, transform: "scale(1.08)" };
}
