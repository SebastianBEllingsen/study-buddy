"use client";

import { useRouter } from "next/navigation";

/**
 * Wraps next/navigation's router.push in document.startViewTransition()
 * when the browser supports it (Chrome, Edge, Safari 18+ as of 2026;
 * Firefox doesn't yet). Degrades to a plain push everywhere else — no
 * feature detection needed by callers.
 */
export function useViewTransitionRouter() {
  const router = useRouter();

  function push(href: string) {
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      document.startViewTransition(() => {
        router.push(href);
      });
    } else {
      router.push(href);
    }
  }

  return { push };
}
