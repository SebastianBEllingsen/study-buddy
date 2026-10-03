"use client";

import { useSyncExternalStore } from "react";

// A value kept in localStorage and shared by every component that reads it —
// the same shape as the Today session store (components/today/todayStore.ts).
// Per device; if storage isn't available the value just isn't remembered.
export function createStoredState<T>(key: string, parse: (raw: unknown) => T, fallback: T) {
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cached: T = fallback;

  function read(): T {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return cached;
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        cached = raw ? parse(JSON.parse(raw)) : fallback;
      } catch {
        cached = fallback;
      }
    }
    return cached;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return {
    write(value: T) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage unavailable
      }
      // Remembered even then, for this page view.
      cached = value;
      cachedRaw = undefined;
      for (const l of listeners) l();
    },
    useValue(): T {
      return useSyncExternalStore(subscribe, read, () => fallback);
    },
  };
}
