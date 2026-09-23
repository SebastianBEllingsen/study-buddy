// The adaptive nav bar (Settings → Appearance → Nav bar color): the header
// takes its color from whatever part of the page's backdrop picture or the
// app wallpaper is under it, as you scroll. A page can't read the pixels
// actually on screen, so this reads the known picture's pixels instead (a
// tiny downscaled copy, see components/AdaptiveHeader.tsx) and works out
// which part of it sits under the header. The math is here, pure.

export const HEADER_TINT_MODES = ["static", "adaptive", "adaptive-text"] as const;
export type HeaderTintMode = (typeof HEADER_TINT_MODES)[number];

export const HEADER_TINT_LABELS: Record<HeaderTintMode, string> = {
  static: "Static",
  adaptive: "Follows the background",
  "adaptive-text": "Follows the background + adapts text",
};

export function parseHeaderTintMode(value: unknown): HeaderTintMode {
  return (HEADER_TINT_MODES as readonly unknown[]).includes(value) ? (value as HeaderTintMode) : "static";
}

export type Rgb = readonly [number, number, number];

// Average color of each horizontal strip of an RGBA image, top to bottom —
// one strip per row of the (already downscaled) image. Pixels are weighted
// by alpha, so a sticker's see-through areas don't drag the average toward
// black; a strip that's fully see-through is null.
export function stripColors(rgba: Uint8ClampedArray, width: number, height: number): (Rgb | null)[] {
  const strips: (Rgb | null)[] = [];
  for (let y = 0; y < height; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      r += rgba[i] * a;
      g += rgba[i + 1] * a;
      b += rgba[i + 2] * a;
      weight += a;
    }
    strips.push(weight > 0 ? [r / weight, g / weight, b / weight] : null);
  }
  return strips;
}

// The color `fraction` (0 = top, 1 = bottom) of the way down the picture,
// blended between the two nearest strips so it changes smoothly on scroll.
// See-through strips are skipped; null if there's nothing opaque at all.
export function colorAtFraction(strips: (Rgb | null)[], fraction: number): Rgb | null {
  const opaque = strips.map((color, i) => ({ color, i })).filter((s): s is { color: Rgb; i: number } => s.color !== null);
  if (opaque.length === 0) return null;
  const pos = Math.min(1, Math.max(0, fraction)) * (strips.length - 1);
  const before = [...opaque].reverse().find((s) => s.i <= pos) ?? opaque[0];
  const after = opaque.find((s) => s.i >= pos) ?? opaque[opaque.length - 1];
  if (before.i === after.i) return before.color;
  return mix(before.color, after.color, (pos - before.i) / (after.i - before.i));
}

// `t` of the way from a to b.
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// WCAG relative luminance, 0 (black) – 1 (white).
export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// WCAG contrast ratio between two colors, 1 (none) – 21 (black on white).
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// The app name in the header keeps the theme's accent color while it stays
// readable on the header's current color; below this contrast it switches
// to the header's adapted text color instead. 3:1 is WCAG's minimum for
// large text — the name is large, bold, logo-style type.
export const BRAND_MIN_CONTRAST = 3;

export function brandNeedsAdapting(brand: Rgb, background: Rgb): boolean {
  return contrastRatio(brand, background) < BRAND_MIN_CONTRAST;
}

// Whichever of white or near-black text has more contrast on `background`.
export function textToneFor(background: Rgb): "light" | "dark" {
  const l = relativeLuminance(background);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / 0.0561; // #111111
  return onWhite >= onDark ? "light" : "dark";
}

// How far down a page backdrop the header's middle line sits: 0 while the
// backdrop still starts below the header (the top of the page), rising as
// it scrolls up under the header, past 1 once it has scrolled out of view.
export function backdropFractionUnderHeader(headerHeight: number, backdropTop: number, backdropHeight: number): number {
  if (backdropHeight <= 0) return Infinity;
  return (headerHeight / 2 - backdropTop) / backdropHeight;
}

// Same for the fixed, cover-fitted wallpaper: which fraction of the picture
// is drawn at the header's middle line of the window.
export function wallpaperFractionUnderHeader(
  headerHeight: number,
  viewport: { width: number; height: number },
  image: { width: number; height: number }
): number {
  const scale = Math.max(viewport.width / image.width, viewport.height / image.height);
  const drawnHeight = image.height * scale;
  const offsetTop = (viewport.height - drawnHeight) / 2;
  return (headerHeight / 2 - offsetTop) / drawnHeight;
}
