"use client";

import useSWR from "swr";
import type { AppSettings } from "@/lib/models";

export interface DocumentBadgeSettings {
  enabled: boolean;
  detail: "detailed" | "minimal";
}

// Reads from the same shared "/api/settings" SWR cache AppBranding seeds
// with the full, server-rendered AppSettings on first paint (see
// AppBranding.tsx) — so this resolves to the real persisted value
// immediately on mount instead of a hardcoded default that then flashes
// into place once its own independent fetch finishes, which is what a
// plain useState+fetch hook here previously did.
export function useDocumentBadgeSettings(): DocumentBadgeSettings {
  const { data } = useSWR<AppSettings>("/api/settings");
  return {
    enabled: data?.documentBadgesEnabled ?? true,
    detail: data?.documentBadgeDetail ?? "detailed",
  };
}
