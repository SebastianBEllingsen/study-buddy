"use client";

import { useRef } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { HelpTooltip } from "@/components/HelpTooltip";
import type { AppSettings } from "@/lib/models";
import {
  MAX_WALLPAPER_BLUR,
  WALLPAPER_AREAS,
  WALLPAPER_AREA_LABELS,
  type AppWallpaperSettings,
} from "@/lib/appWallpaper";

// Settings → Appearance: the dashboard backdrop as a wallpaper behind the
// rest of the app (see components/AppWallpaper.tsx). Every change is
// applied to the shared settings cache immediately, so the wallpaper
// previews live behind this dialog while a slider is dragged; the save to
// the server is debounced until the value settles.
export function AppWallpaperSettings() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (!settings) return null;
  const wallpaper = settings.appWallpaper;
  const hasImage = !!settings.dashboardBackgroundImage;

  function update(patch: Partial<AppWallpaperSettings>) {
    const next = { ...wallpaper, ...patch };
    mutate((s) => (s ? { ...s, appWallpaper: next } : s), { revalidate: false });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appWallpaper: next }),
        });
        if (!res.ok) throw new Error();
      } catch {
        toast.error("Couldn't save wallpaper settings");
        mutate();
      }
    }, 300);
  }

  return (
    <div className="space-y-2 pt-2">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          Use as app wallpaper
          <HelpTooltip>
            Shows the dashboard backdrop behind other pages too, fixed in place while they scroll.
            A course&apos;s own backdrop stays on top as its header, fading into the wallpaper.
          </HelpTooltip>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={hasImage && wallpaper.enabled}
          disabled={!hasImage}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
      </label>
      {!hasImage && <p className="text-xs text-muted-foreground">Add a dashboard backdrop above to use it.</p>}
      {hasImage && wallpaper.enabled && (
        <div className="space-y-3 rounded-md border p-2.5">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs text-muted-foreground">Show on</legend>
            {WALLPAPER_AREAS.map((area) => (
              <label key={area} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={wallpaper.areas.includes(area)}
                  onChange={(e) =>
                    update({
                      areas: e.target.checked
                        ? WALLPAPER_AREAS.filter((a) => a === area || wallpaper.areas.includes(a))
                        : wallpaper.areas.filter((a) => a !== area),
                    })
                  }
                />
                {WALLPAPER_AREA_LABELS[area]}
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1 text-xs">
            <span className="flex justify-between text-muted-foreground">
              Dim <span className="tabular-nums">{wallpaper.dim}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={wallpaper.dim}
              onChange={(e) => update({ dim: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="flex justify-between text-muted-foreground">
              Blur <span className="tabular-nums">{wallpaper.blur}px</span>
            </span>
            <input
              type="range"
              min={0}
              max={MAX_WALLPAPER_BLUR}
              value={wallpaper.blur}
              onChange={(e) => update({ blur: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </label>
        </div>
      )}
    </div>
  );
}
