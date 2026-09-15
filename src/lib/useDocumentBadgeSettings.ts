"use client";

import { useEffect, useState } from "react";

export interface DocumentBadgeSettings {
  enabled: boolean;
  detail: "detailed" | "minimal";
}

// Defaults match app_settings.document_badges_enabled/document_badge_detail's
// own defaults so the badge doesn't flash in/change shape once this resolves
// — same reasoning as useShowModelBadge.
const DEFAULTS: DocumentBadgeSettings = { enabled: true, detail: "detailed" };

export function useDocumentBadgeSettings(): DocumentBadgeSettings {
  const [settings, setSettings] = useState<DocumentBadgeSettings>(DEFAULTS);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((body: { documentBadgesEnabled: boolean; documentBadgeDetail: "detailed" | "minimal" }) =>
        setSettings({ enabled: body.documentBadgesEnabled, detail: body.documentBadgeDetail })
      )
      .catch(() => {});
  }, []);
  return settings;
}
