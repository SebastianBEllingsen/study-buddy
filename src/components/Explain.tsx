"use client";

import { useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { TooltipContent } from "@/components/ui/tooltip";
import { EXPLANATIONS, type ExplanationId } from "@/lib/explanations";

// Hover explanations: rest the pointer on a button (or focus it with the
// keyboard) and a short note says what it does. Designed to stay out of the
// way:
// - opens only after a deliberate pause (OPEN_DELAY), not when the pointer
//   just passes over — and once one is open, neighbouring buttons explain
//   themselves instantly (ExplainProvider's grouping window), so scanning a
//   toolbar reads like a legend
// - opens right away on keyboard focus, closes on Escape, on click, or when
//   the pointer leaves; you can move onto the note to read it (WCAG 1.4.13)
// - a footer shows the keyboard shortcut and whether the click uses AI
// - switched off per device in Settings, once the app is familiar
// Buttons already say what they are; these say what happens.

export const OPEN_DELAY = 600;
const GROUP_WINDOW = 500;
const STORAGE_KEY = "studybuddy-hover-explanations";
const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useExplanationsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, () => true);
}

export function setExplanationsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // storage unavailable: the choice just won't persist
  }
  for (const l of listeners) l();
}

// Mounted once around the app so explanations share the grouping window.
export function ExplainProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={OPEN_DELAY} timeout={GROUP_WINDOW}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

// Wrap a single button (or link-button). The child receives the trigger
// props, so it must forward refs and props — every ui/button does.
export function Explain({
  id,
  children,
  side = "top",
}: {
  id: ExplanationId;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const enabled = useExplanationsEnabled();
  if (!enabled) return children;
  const explanation = EXPLANATIONS[id];
  const footer = "shortcut" in explanation || ("ai" in explanation && explanation.ai);
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} delay={OPEN_DELAY} />
      <TooltipContent side={side} className="max-w-64 text-left leading-snug whitespace-normal">
        <p>{explanation.text}</p>
        {footer && (
          <p className="mt-1 flex items-center gap-2 text-[0.7rem] opacity-70">
            {"shortcut" in explanation && (
              <span>
                Key <kbd className="rounded border border-current/40 px-1 font-sans">{explanation.shortcut}</kbd>
              </span>
            )}
            {"ai" in explanation && explanation.ai && (
              <span className="flex items-center gap-1">
                <Sparkles className="size-3" />
                Uses AI
              </span>
            )}
          </p>
        )}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}
