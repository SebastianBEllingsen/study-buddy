"use client";

import { useEffect, useState } from "react";
import { SWRConfig } from "swr";
import { fetcher } from "@/lib/swrFetcher";
import { readSnapshot, shouldPersist, writeSnapshot } from "@/lib/swrPersist";

// SWR's cache, mirrored to IndexedDB (see lib/swrPersist.ts) so it survives
// reloads and app restarts. Writes are debounced; a page being closed or
// hidden flushes right away.
class PersistedCache extends Map<string, { data?: unknown; error?: unknown }> {
  private timer: ReturnType<typeof setTimeout> | null = null;

  set(key: string, value: { data?: unknown; error?: unknown }) {
    super.set(key, value);
    if (shouldPersist(key)) this.scheduleSave();
    return this;
  }

  delete(key: string) {
    const deleted = super.delete(key);
    if (shouldPersist(key)) this.scheduleSave();
    return deleted;
  }

  // Fills in saved data only where nothing newer has arrived yet.
  restore(entries: [string, unknown][]) {
    for (const [key, data] of entries) {
      const current = super.get(key);
      if (current?.data === undefined) super.set(key, { ...current, data });
    }
  }

  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1000);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const entries: [string, unknown][] = [];
    for (const [key, state] of this) {
      if (shouldPersist(key) && state?.data !== undefined && state.error === undefined) entries.push([key, state.data]);
    }
    writeSnapshot(entries).catch(() => {
      // Private windows / blocked storage: the app still works, just uncached.
    });
  }
}

const clientCache = typeof window === "undefined" ? null : new PersistedCache();

// Restored once per page load; a slow or unavailable IndexedDB never holds
// the page back for long.
let restoring: Promise<void> | null = null;
function restoreCache(): Promise<void> {
  if (!clientCache) return Promise.resolve();
  restoring ??= Promise.race([
    readSnapshot()
      .then((entries) => clientCache.restore(entries))
      .catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 400)),
  ]);
  return restoring;
}

// Wraps the page area: renders nothing until the saved cache is back, so
// every useSWR below mounts with last session's data already there. It
// can't be applied during hydration instead — SWR would hand React cached
// data the server never rendered — so the server and the first client
// render both output nothing here, and the page renders right after.
export function SWRCacheGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    restoreCache().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready ? children : null;
}

// One cache for the whole app, provided above every route — this is what
// lets a course's data still be there, instantly, when you leave and come
// back a minute later, instead of every page mount starting from a blank
// skeleton and re-fetching from zero. See useSWR() call sites for the
// stale-while-revalidate read side; onSuccess-driven cross-page invalidation
// (e.g. a generation on the course page updating the home dashboard's dot)
// goes through this same cache via useSWRConfig()'s mutate.
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!clientCache) return;
    const flush = () => clientCache.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <SWRConfig
      value={{
        fetcher,
        // Server renders get a fresh throwaway cache; the browser gets the
        // persisted one.
        provider: () => clientCache ?? new Map(),
        // Revisiting a tab (or switching back to it) revalidates in the
        // background — this is also what fixes a course card's "just
        // generated" dot or the per-item pill going stale across tabs,
        // without needing a manual reload.
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        // Multiple widgets on one page requesting the same key (e.g. two
        // widgets both reading /api/stats) share a single request instead
        // of firing it twice.
        dedupingInterval: 2000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
