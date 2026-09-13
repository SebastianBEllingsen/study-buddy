// The curated heading-font picker (Settings → Appearance) — every one of
// these families is already loaded via next/font in layout.tsx (the 5
// built-in appearance themes each use one as their own heading font, plus
// Geist Sans/Mono as the two that are always the default body/code faces
// regardless of theme), so picking one is just pointing --heading-font at a
// CSS variable that's already on the page — no new font ever needs to load.
//
// Kept in its own file (not lib/models.ts, which is server-only and pulls
// in better-sqlite3) so client components can import this list as a value
// without dragging the whole DB layer into the browser bundle — same
// reasoning as lib/homeWidgetMeta.ts.
export const FONT_CHOICES = [
  { key: "serif", label: "Source Serif", cssVar: "--font-source-serif" },
  { key: "sans", label: "Geist Sans", cssVar: "--font-geist-sans" },
  { key: "grotesk", label: "Space Grotesk", cssVar: "--font-space-grotesk" },
  { key: "spectral", label: "Spectral", cssVar: "--font-spectral" },
  { key: "plex", label: "IBM Plex Sans", cssVar: "--font-ibm-plex-sans" },
  { key: "lato", label: "Lato", cssVar: "--font-lato" },
  { key: "mono", label: "Geist Mono", cssVar: "--font-geist-mono" },
] as const;
export type FontChoiceKey = (typeof FONT_CHOICES)[number]["key"];
