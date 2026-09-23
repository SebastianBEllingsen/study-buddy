"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import type { AppSettings } from "@/lib/models";
import { shouldShowWallpaper } from "@/lib/appWallpaper";
import {
  backdropFractionUnderHeader,
  colorAtFraction,
  mix,
  stripColors,
  textToneFor,
  wallpaperFractionUnderHeader,
  type Rgb,
} from "@/lib/headerTint";

// Settings → Appearance → Nav bar color, when it isn't "Static": colors the
// app header from whatever part of the page's backdrop (an element marked
// data-page-backdrop="<url>" — the course page and dashboard banners) or
// the app wallpaper sits under it, recomputed as you scroll. Results go on
// <html> as --header-tint / data-header-adaptive / data-header-text, which
// globals.css applies to the header.
//
// Pixels are read from a tiny downscaled copy of the picture, not the screen
// (a page can't read what's on screen). The picture is loaded with
// crossOrigin so its pixels are readable — Supabase Storage allows that —
// and the browser reuses its cached copy where it can.

const SAMPLE_WIDTH = 16;
const SAMPLE_HEIGHT = 48;

interface Sample {
  strips: (Rgb | null)[];
  width: number;
  height: number;
}

const samples = new Map<string, Sample | null | "loading">();

function sample(url: string, onReady: () => void): Sample | null {
  const cached = samples.get(url);
  if (cached === "loading") return null;
  if (cached !== undefined) return cached;
  samples.set(url, "loading");
  const img = new Image();
  if (!url.startsWith("data:")) img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_WIDTH;
      canvas.height = SAMPLE_HEIGHT;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(img, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const data = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
      samples.set(url, {
        strips: stripColors(data, SAMPLE_WIDTH, SAMPLE_HEIGHT),
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    } catch {
      // Pixels not readable (no CORS permission) — the header stays as is.
      samples.set(url, null);
    }
    onReady();
  };
  img.onerror = () => {
    samples.set(url, null);
    onReady();
  };
  img.src = url;
  return null;
}

// Any CSS color (the theme's tokens are oklch, hex, rgba…) as RGB, by
// letting a canvas parse and paint it.
let colorCanvas: CanvasRenderingContext2D | null = null;
function cssColorToRgb(value: string): Rgb | null {
  if (!value.trim()) return null;
  colorCanvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!colorCanvas) return null;
  colorCanvas.clearRect(0, 0, 1, 1);
  colorCanvas.fillStyle = "#000";
  colorCanvas.fillStyle = value;
  colorCanvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorCanvas.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const ATTRS = ["data-header-adaptive", "data-header-text"] as const;

export default function AdaptiveHeader() {
  const pathname = usePathname();
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const mode = settings?.headerTint ?? "static";
  const wallpaperImage =
    settings && shouldShowWallpaper(settings.appWallpaper, settings.dashboardBackgroundImage, pathname)
      ? settings.dashboardBackgroundImage
      : null;
  const dim = settings?.appWallpaper.dim ?? 0;

  useEffect(() => {
    if (mode === "static") return;
    const root = document.documentElement;
    let frame = 0;

    function clear() {
      for (const attr of ATTRS) root.removeAttribute(attr);
      root.style.removeProperty("--header-tint");
    }

    function apply() {
      frame = 0;
      const header = document.querySelector<HTMLElement>('[data-slot="app-header"]');
      if (!header) return clear();
      const headerHeight = header.offsetHeight;
      const styles = getComputedStyle(root);

      let color: Rgb | null = null;
      const backdrop = document.querySelector<HTMLElement>("[data-page-backdrop]");
      const backdropUrl = backdrop?.dataset.pageBackdrop;
      if (backdrop && backdropUrl) {
        const picture = sample(backdropUrl, schedule);
        const rect = backdrop.getBoundingClientRect();
        const fraction = backdropFractionUnderHeader(headerHeight, rect.top, rect.height);
        if (picture && fraction <= 1) color = colorAtFraction(picture.strips, fraction);
      }
      if (!color && wallpaperImage) {
        const picture = sample(wallpaperImage, schedule);
        if (picture) {
          const fraction = wallpaperFractionUnderHeader(
            headerHeight,
            { width: window.innerWidth, height: window.innerHeight },
            picture
          );
          const raw = colorAtFraction(picture.strips, fraction);
          const background = cssColorToRgb(styles.getPropertyValue("--background"));
          // Matches the wallpaper's own dim layer.
          if (raw) color = background ? mix(raw, background, dim / 100) : raw;
        }
      }
      if (!color) return clear();

      // A touch of the theme's card color keeps the header from looking
      // like a hole punched in the page.
      const card = cssColorToRgb(styles.getPropertyValue("--card"));
      const tint = card ? mix(color, card, 0.25) : color;
      root.style.setProperty("--header-tint", `rgb(${tint.map(Math.round).join(" ")})`);
      root.setAttribute("data-header-adaptive", "");
      if (mode === "adaptive-text") root.setAttribute("data-header-text", textToneFor(tint));
      else root.removeAttribute("data-header-text");
    }

    // Once per frame while visible. Browsers pause animation frames in a
    // hidden page (a background tab, or a window fully covered by another),
    // so there a plain timer keeps the header right for when it reappears.
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      if (document.hidden) {
        clearTimeout(timer);
        timer = setTimeout(apply, 100);
      } else if (!frame) {
        frame = requestAnimationFrame(apply);
      }
    }

    // Scrolling and resizing move the picture under the header; page
    // content mounting (a backdrop appearing after navigation) and theme
    // switches (the card/background colors mixed in) change the result too.
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const contentObserver = new MutationObserver(schedule);
    contentObserver.observe(document.body, { childList: true, subtree: true });
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class", "data-app-theme"] });
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      contentObserver.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      clear();
    };
  }, [mode, wallpaperImage, dim, pathname]);

  return null;
}
