"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import type { AppSettings } from "@/lib/models";
import { DEFAULT_APP_WALLPAPER, isDetachedWindowPath, shouldShowWallpaper } from "@/lib/appWallpaper";

// The dashboard backdrop as a fixed wallpaper behind the rest of the app —
// see lib/appWallpaper.ts for where it shows. Pages scroll over it; the dim
// layer washes it toward the theme's background so text on the page itself
// stays readable. While it shows, <html data-wallpaper> lets globals.css
// make the header and detached windows see-through. A course with its own
// page backdrop sets <html data-page-backdrop>, which hides this again (CSS
// in globals.css), so that course keeps its own look.
export default function AppWallpaper() {
  const pathname = usePathname();
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const image = settings?.dashboardBackgroundImage ?? null;
  const wallpaper = settings?.appWallpaper ?? DEFAULT_APP_WALLPAPER;
  const show = shouldShowWallpaper(wallpaper, image, pathname, false);

  useEffect(() => {
    const root = document.documentElement;
    if (show) root.setAttribute("data-wallpaper", "");
    else root.removeAttribute("data-wallpaper");
    return () => root.removeAttribute("data-wallpaper");
  }, [show]);

  if (!show) return null;
  return (
    <div
      data-slot="app-wallpaper"
      aria-hidden
      // Behind everything normally; in a detached window, above the layout
      // but under the window's own page (z-50), which turns transparent.
      className={`pointer-events-none fixed inset-0 overflow-hidden ${isDetachedWindowPath(pathname) ? "z-[49]" : "-z-10"}`}
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(${image})`,
          // Scaled up slightly while blurred so the soft edge the blur
          // leaves at the window border stays off-screen.
          filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined,
          transform: wallpaper.blur > 0 ? "scale(1.08)" : undefined,
        }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: `color-mix(in oklch, var(--background) ${wallpaper.dim}%, transparent)` }}
      />
    </div>
  );
}
