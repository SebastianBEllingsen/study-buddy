"use client";

import { useEffect, useState } from "react";

// Defaults to true (matching app_settings.show_model_badge's own default)
// so the badge doesn't flash in only after this resolves.
export function useShowModelBadge(): boolean {
  const [show, setShow] = useState(true);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((body: { showModelBadge: boolean }) => setShow(body.showModelBadge))
      .catch(() => {});
  }, []);
  return show;
}
