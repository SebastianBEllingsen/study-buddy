import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_WALLPAPER,
  isDetachedWindowPath,
  normalizeAppWallpaper,
  parseAppWallpaper,
  shouldShowWallpaper,
  wallpaperAreaForPath,
} from "./appWallpaper";

const on = { ...DEFAULT_APP_WALLPAPER, enabled: true };
const img = "https://example.com/backdrop.jpg";

describe("wallpaperAreaForPath", () => {
  it("maps each page to its area", () => {
    expect(wallpaperAreaForPath("/courses/7")).toBe("courses");
    expect(wallpaperAreaForPath("/vault/12")).toBe("notes");
    expect(wallpaperAreaForPath("/vault/12/detached")).toBe("notes");
    expect(wallpaperAreaForPath("/items/3")).toBe("items");
    expect(wallpaperAreaForPath("/calendar")).toBe("other");
    expect(wallpaperAreaForPath("/canvas/4")).toBe("other");
    expect(wallpaperAreaForPath("/documents/9/view")).toBe("other");
    expect(wallpaperAreaForPath("/pomodoro/detached")).toBe("other");
  });

  it("maps the dashboard, and leaves unknown pages out", () => {
    expect(wallpaperAreaForPath("/")).toBe("dashboard");
    expect(wallpaperAreaForPath("/something-new")).toBeNull();
  });
});

describe("shouldShowWallpaper", () => {
  it("shows on enabled areas when switched on with an image", () => {
    expect(shouldShowWallpaper(on, img, "/courses/1")).toBe(true);
  });

  it("needs the switch, an image and the page's area", () => {
    expect(shouldShowWallpaper(DEFAULT_APP_WALLPAPER, img, "/courses/1")).toBe(false);
    expect(shouldShowWallpaper(on, null, "/courses/1")).toBe(false);
    expect(shouldShowWallpaper({ ...on, areas: ["notes"] }, img, "/courses/1")).toBe(false);
    expect(shouldShowWallpaper({ ...on, areas: ["courses"] }, img, "/")).toBe(false);
    expect(shouldShowWallpaper(on, img, "/")).toBe(true);
  });
});

describe("parsing and validation", () => {
  it("defaults when nothing valid is stored", () => {
    expect(parseAppWallpaper(null)).toEqual(DEFAULT_APP_WALLPAPER);
    expect(parseAppWallpaper("nope{")).toEqual(DEFAULT_APP_WALLPAPER);
    expect(parseAppWallpaper('{"enabled":true}')).toEqual(DEFAULT_APP_WALLPAPER);
  });

  it("round-trips valid settings", () => {
    const settings = { enabled: true, areas: ["notes", "items"], dim: 40, blur: 0 };
    expect(parseAppWallpaper(JSON.stringify(settings))).toEqual(settings);
  });

  it("clamps numbers and drops unknown areas", () => {
    expect(normalizeAppWallpaper({ enabled: true, areas: ["other", "bogus", "courses", "dashboard"], dim: 140.4, blur: -3 })).toEqual({
      enabled: true,
      areas: ["dashboard", "courses", "other"],
      dim: 100,
      blur: 0,
    });
    expect(normalizeAppWallpaper({ enabled: true, areas: [], dim: Number.NaN, blur: 1 })).toBeNull();
  });
});

describe("isDetachedWindowPath", () => {
  it("recognizes the popped-out windows", () => {
    expect(isDetachedWindowPath("/vault/12/detached")).toBe(true);
    expect(isDetachedWindowPath("/documents/9/view")).toBe(true);
    expect(isDetachedWindowPath("/chat/view")).toBe(true);
    expect(isDetachedWindowPath("/pomodoro/detached")).toBe(true);
    expect(isDetachedWindowPath("/help/note-syntax")).toBe(true);
  });

  it("leaves normal pages alone", () => {
    expect(isDetachedWindowPath("/vault/12")).toBe(false);
    expect(isDetachedWindowPath("/documents/9")).toBe(false);
    expect(isDetachedWindowPath("/courses/1")).toBe(false);
  });
});
