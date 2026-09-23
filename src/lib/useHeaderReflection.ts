"use client";

import { useEffect } from "react";

// Tints the app header with a page's backdrop picture — a heavily blurred,
// faded copy of it behind the header's content (globals.css,
// data-header-reflection) — so the header picks up the picture's colors
// while the picture itself starts right below it. Used by the dashboard
// and course pages for their backdrops; null clears it.
export function useHeaderReflection(image: string | null | undefined) {
  useEffect(() => {
    if (!image) return;
    const root = document.documentElement;
    root.style.setProperty("--header-reflection", `url(${JSON.stringify(image)})`);
    root.setAttribute("data-header-reflection", "");
    return () => {
      root.removeAttribute("data-header-reflection");
      root.style.removeProperty("--header-reflection");
    };
  }, [image]);
}
