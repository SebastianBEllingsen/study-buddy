"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import useSWR from "swr";
import type { AppSettings } from "@/lib/models";

// The header wordmark — server-rendered correctly on first paint (see
// layout.tsx, which fetches settings directly and passes them as `initial`
// / SWR's fallbackData), then kept live afterward through the same shared
// /api/settings cache every other settings-reading component already uses:
// saving a new name/icon in SettingsDialog updates this without a reload.
// `initial` is the *whole* AppSettings object (not just the branding fields
// this component reads) so that shared "/api/settings" cache entry starts
// out fully populated the moment this mounts — every other hook reading
// from it (useDocumentBadgeSettings, FontPicker/BrandingSection's own
// useSWR calls, …) gets the real persisted value on its very first render
// too, instead of a fallback/default guess that flashes into the right
// value once its own fetch resolves.
export default function AppBranding({ initial }: { initial: AppSettings }) {
  const { data } = useSWR<AppSettings>("/api/settings", { fallbackData: initial });
  const name = data?.appName || "Study Buddy";
  const iconImage = data?.appIconImage;
  const icon = data?.appIcon;

  return (
    <Link href="/" data-slot="app-brand" className="flex items-center gap-2 font-heading text-lg font-semibold text-primary">
      {iconImage ? (
        <span
          className="size-5 shrink-0 rounded bg-cover bg-center"
          style={{ backgroundImage: `url(${iconImage})` }}
        />
      ) : icon ? (
        <span className="text-lg leading-none">{icon}</span>
      ) : (
        <BookOpen className="size-5" />
      )}
      {name}
    </Link>
  );
}
