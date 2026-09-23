"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { APP_THEME_STORAGE_KEY, isAppTheme, type AppTheme } from "@/lib/appThemes";

export type { AppTheme };

const AppThemeContext = createContext<{
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
} | null>(null);

// A second, independent theme axis alongside next-themes' light/dark toggle
// (ThemeProvider.tsx) — deliberately not built on next-themes itself, since
// its context is a singleton keyed by the imported `useTheme` hook: nesting
// a second next-themes provider for a different attribute would shadow the
// outer one for any consumer, breaking the existing light/dark toggle. This
// mirrors next-themes' own approach instead (attribute on <html>,
// localStorage-backed, blocking inline script in layout.tsx to set the
// attribute before first paint so there's no flash of the wrong skin).
export default function AppThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazily read the DOM attribute (not localStorage directly) so this
  // matches whatever the blocking script in layout.tsx already set before
  // hydration — no flash, no hydration mismatch (React never renders this
  // attribute itself, so it has no expectations to reconcile against, the
  // same trick next-themes relies on for the "dark" class).
  const [theme, setThemeState] = useState<AppTheme>(() => {
    if (typeof document === "undefined") return "calm";
    const attr = document.documentElement.getAttribute("data-app-theme");
    return isAppTheme(attr) ? attr : "calm";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-app-theme", theme);
  }, [theme]);

  function setTheme(next: AppTheme) {
    setThemeState(next);
    try {
      localStorage.setItem(APP_THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — harmless, just won't persist.
    }
  }

  return (
    <AppThemeContext.Provider value={{ theme, setTheme }}>{children}</AppThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used inside AppThemeProvider");
  return ctx;
}
