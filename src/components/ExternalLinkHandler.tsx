"use client";

import { useEffect } from "react";
import { isExternalHttpUrl, openExternal } from "@/lib/externalLinks";

// Routes every click on an external link through openExternal, so links
// rendered anywhere (markdown notes, calendar events, ...) open in the
// user's default browser (see lib/externalLinks.ts). Captured at
// the document level ahead of React's own handlers, so components that
// stopPropagation() on their links are still covered.
export default function ExternalLinkHandler() {
  useEffect(() => {
    function handle(event: MouseEvent) {
      if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!isExternalHttpUrl(anchor.href, window.location.origin)) return;
      event.preventDefault();
      void openExternal(anchor.href);
    }
    document.addEventListener("click", handle, true);
    document.addEventListener("auxclick", handle, true);
    return () => {
      document.removeEventListener("click", handle, true);
      document.removeEventListener("auxclick", handle, true);
    };
  }, []);

  return null;
}
