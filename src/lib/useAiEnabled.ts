"use client";

import useSWR from "swr";
import type { AppSettings } from "@/lib/models";

// Reads from the same shared "/api/settings" SWR cache AppBranding seeds
// with the full, server-rendered AppSettings on first paint (see
// AppBranding.tsx and useDocumentBadgeSettings's identical reasoning) — so
// this resolves to the real persisted value immediately on mount instead of
// a hardcoded default that then flashes into place. Defaults to true (the
// setting's own default) so AI controls don't flash away and back on load.
export function useAiEnabled(): boolean {
  const { data } = useSWR<AppSettings>("/api/settings");
  return data?.aiEnabled ?? true;
}
