"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import useSWR from "swr";

interface BrandingData {
  appName: string | null;
  appIcon: string | null;
  appIconImage: string | null;
}

// The header wordmark — server-rendered correctly on first paint (see
// layout.tsx, which fetches settings directly and passes them as `initial`
// / SWR's fallbackData), then kept live afterward through the same shared
// /api/settings cache every other settings-reading component already uses:
// saving a new name/icon in SettingsDialog updates this without a reload.
export default function AppBranding({ initial }: { initial: BrandingData }) {
  const { data } = useSWR<BrandingData>("/api/settings", { fallbackData: initial });
  const name = data?.appName || "Study Buddy";
  const iconImage = data?.appIconImage;
  const icon = data?.appIcon;

  return (
    <Link href="/" className="flex items-center gap-2 font-heading text-lg font-semibold text-primary">
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
