"use client";

import { useRef } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { SettingGroup, SettingSlider, SettingToggle } from "@/components/SettingToggle";
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
    <div className="space-y-2">
      <SettingToggle
        label="Use backdrop as app wallpaper"
        help={
          hasImage
            ? "Shows the dashboard backdrop behind other pages too, fixed in place while they scroll."
            : "Add a dashboard backdrop above to use it."
        }
        checked={hasImage && wallpaper.enabled}
        disabled={!hasImage}
        onChange={(checked) => update({ enabled: checked })}
      />
      {hasImage && wallpaper.enabled && (
        <SettingGroup>
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
          <SettingSlider
            label="Dim"
            valueLabel={`${wallpaper.dim}%`}
            min={0}
            max={100}
            value={wallpaper.dim}
            onChange={(dim) => update({ dim })}
          />
          <SettingSlider
            label="Blur"
            valueLabel={`${wallpaper.blur}px`}
            min={0}
            max={MAX_WALLPAPER_BLUR}
            value={wallpaper.blur}
            onChange={(blur) => update({ blur })}
          />
        </SettingGroup>
      )}
    </div>
  );
}

// Settings → Courses: hide every course's own backdrop/cover banner or
// icon on its page — e.g. so the app wallpaper is the only background
// inside courses. Works with the wallpaper on or off; the courses keep
// their images (see lib/coursePageDisplay.ts).
export function CoursePageAppearanceSettings() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  if (!settings) return null;

  async function save(field: "hideCourseBackdrops" | "hideCourseIcons", value: boolean) {
    mutate((s) => (s ? { ...s, [field]: value } : s), { revalidate: false });
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save that setting");
      mutate((s) => (s ? { ...s, [field]: !value } : s), { revalidate: false });
    }
  }

  return (
    <>
      <SettingToggle
        label="Hide course backdrops"
        help="Hides each course's backdrop and cover banner on its page, so only the app wallpaper (if on) shows. The images stay saved."
        checked={settings.hideCourseBackdrops}
        onChange={(checked) => save("hideCourseBackdrops", checked)}
      />
      <SettingToggle
        label="Hide course icons"
        help="Hides the icon next to the course name on its page. Course cards keep theirs."
        checked={settings.hideCourseIcons}
        onChange={(checked) => save("hideCourseIcons", checked)}
      />
    </>
  );
}
