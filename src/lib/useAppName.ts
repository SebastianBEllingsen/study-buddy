"use client";

import useSWR from "swr";
import type { AppSettings } from "@/lib/models";

export const DEFAULT_APP_NAME = "Study Buddy";

// The name set in Settings → Branding, for wherever the UI refers to the app
// (breadcrumb roots, empty-state copy). Same shared "/api/settings" cache as
// AppBranding's header wordmark, so the two always agree.
export function useAppName(): string {
  const { data } = useSWR<AppSettings>("/api/settings");
  return data?.appName || DEFAULT_APP_NAME;
}
