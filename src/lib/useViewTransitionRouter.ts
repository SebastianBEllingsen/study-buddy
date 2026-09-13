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
      // A second navigation fired before the first's transition finishes
      // (e.g. a quick double-click, or two nav links clicked back to back)
      // skips the earlier one — the spec's documented, expected outcome,
      // not a real error. It surfaces as a rejected `ready` promise (the
      // one that rejects specifically when a transition is skipped before
      // it starts animating) — `finished` alone doesn't catch this.
      const transition = document.startViewTransition(() => {
        router.push(href);
      });
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
    } else {
      router.push(href);
    }
  }

  return { push };
}
