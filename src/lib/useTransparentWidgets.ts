"use client";

import useSWR from "swr";
import type { AppSettings } from "@/lib/models";

// Settings → "Transparent widgets": cards sit straight on the wallpaper or
// backdrop instead of on a surface of their own. The dashboard's widgets read
// it, and so do the Today and study plan cards wherever they appear (the
// dashboard and each course), so one setting governs them all. Same shared
// "/api/settings" cache as useAiEnabled.
export function useTransparentWidgets(): boolean {
  const { data } = useSWR<AppSettings>("/api/settings");
  return data?.dashboardTransparentWidgets ?? false;
}

// How a card looks with "Transparent widgets" on: still a card, but see-through
// and frosted, so the picture shows while the text stays readable on any part
// of it. (Fully clear text on a bright patch of wallpaper can't be read.)
export const FROSTED_CARD = "bg-card/70 backdrop-blur-md";

export type TodayCardLook = "solid" | "frosted" | "plain";

// How the settings turn out for the Today card: hidden or not, and its look.
// Transparent widgets off is a solid card whatever else is set; on, the
// frosted-card setting picks between the frosted panel and plain text on the
// picture. Defaults (shown, frosted) apply until settings arrive, so the card
// doesn't flash away or change shape on load.
export function todayCardLook(settings: Pick<AppSettings, "dashboardTransparentWidgets" | "todayCardShown" | "todayCardFrosted"> | undefined): {
  shown: boolean;
  look: TodayCardLook;
} {
  const transparent = settings?.dashboardTransparentWidgets ?? false;
  const frosted = settings?.todayCardFrosted ?? true;
  return { shown: settings?.todayCardShown ?? true, look: !transparent ? "solid" : frosted ? "frosted" : "plain" };
}

export function useTodayCardLook() {
  const { data } = useSWR<AppSettings>("/api/settings");
  return todayCardLook(data);
}
