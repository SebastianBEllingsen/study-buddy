// The dashboard backdrop reused as a wallpaper behind the rest of the app
// (Settings → Appearance → "Use as app wallpaper"). Stored as JSON in
// app_settings.app_wallpaper; rendered by components/AppWallpaper.tsx.

export const WALLPAPER_AREAS = ["courses", "notes", "items", "other"] as const;
export type WallpaperArea = (typeof WALLPAPER_AREAS)[number];

export const WALLPAPER_AREA_LABELS: Record<WallpaperArea, string> = {
  courses: "Course pages",
  notes: "Notes",
  items: "Quizzes & flashcards",
  other: "Calendar, canvases & documents",
};

export interface AppWallpaperSettings {
  enabled: boolean;
  areas: WallpaperArea[];
  // 0–100: how strongly the image is washed toward the theme background.
  dim: number;
  // 0–24 px of blur.
  blur: number;
}

export const MAX_WALLPAPER_BLUR = 24;

export const DEFAULT_APP_WALLPAPER: AppWallpaperSettings = {
  enabled: false,
  areas: [...WALLPAPER_AREAS],
  dim: 72,
  blur: 6,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Validates an API body or a stored value. Out-of-range numbers are clamped
// and unknown areas dropped; anything not shaped like the settings is null.
export function normalizeAppWallpaper(value: unknown): AppWallpaperSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const { enabled, areas, dim, blur } = value as Record<string, unknown>;
  if (
    typeof enabled !== "boolean" ||
    !Array.isArray(areas) ||
    typeof dim !== "number" ||
    !Number.isFinite(dim) ||
    typeof blur !== "number" ||
    !Number.isFinite(blur)
  ) {
    return null;
  }
  return {
    enabled,
    areas: WALLPAPER_AREAS.filter((area) => areas.includes(area)),
    dim: clamp(dim, 0, 100),
    blur: clamp(blur, 0, MAX_WALLPAPER_BLUR),
  };
}

export function parseAppWallpaper(raw: string | null | undefined): AppWallpaperSettings {
  if (!raw) return DEFAULT_APP_WALLPAPER;
  try {
    return normalizeAppWallpaper(JSON.parse(raw)) ?? DEFAULT_APP_WALLPAPER;
  } catch {
    return DEFAULT_APP_WALLPAPER;
  }
}

// Which area a page belongs to. The dashboard ("/") has its own backdrop
// styles and never gets the wallpaper.
export function wallpaperAreaForPath(pathname: string): WallpaperArea | null {
  const [, first] = pathname.split("/");
  switch (first) {
    case "courses":
      return "courses";
    case "vault":
      return "notes";
    case "items":
      return "items";
    case "calendar":
    case "canvas":
    case "documents":
    case "chat":
    case "help":
      return "other";
    default:
      return null;
  }
}

// Whether the wallpaper shows on `pathname`. `pageHasOwnBackdrop` is a
// course page with its own page backdrop, which wins over the wallpaper.
export function shouldShowWallpaper(
  settings: AppWallpaperSettings,
  image: string | null,
  pathname: string,
  pageHasOwnBackdrop: boolean
): boolean {
  if (!settings.enabled || !image || pageHasOwnBackdrop) return false;
  const area = wallpaperAreaForPath(pathname);
  return area !== null && settings.areas.includes(area);
}

// Detached windows (a note, document, chat or the syntax guide popped out)
// cover the whole layout — header included — with their own full-window
// page. The wallpaper has to sit above the layout there, just under that
// page, instead of behind everything.
export function isDetachedWindowPath(pathname: string): boolean {
  return (
    /^\/vault\/[^/]+\/detached\/?$/.test(pathname) ||
    /^\/documents\/[^/]+\/view\/?$/.test(pathname) ||
    /^\/chat\/view\/?$/.test(pathname) ||
    pathname.startsWith("/help/")
  );
}
