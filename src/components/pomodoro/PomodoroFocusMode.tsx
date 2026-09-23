"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Minimize2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { PHASE_LABELS, formatRemaining, getProgress, getRemainingMs } from "@/lib/pomodoro";
import { usePomodoro } from "./PomodoroProvider";
import { ProgressRing, SessionDots, TimerControls, phaseTextClass } from "./PomodoroParts";

// Distraction-free full-window timer. Opened from the header popover, which
// also asks the browser for real fullscreen; leaving fullscreen (Esc, or
// the browser's own exit gesture) closes this overlay too, so the two never
// get out of sync. Space toggles start/pause.
export default function PomodoroFocusMode() {
  const { state, settings, now, start, pause, closeFocusMode } = usePomodoro();
  const wasFullscreen = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
    function onFullscreenChange() {
      if (document.fullscreenElement) wasFullscreen.current = true;
      else if (wasFullscreen.current) closeFocusMode();
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [closeFocusMode]);

  const running = state.status === "running";
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFocusMode();
      } else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (running) pause();
        else start();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, start, pause, closeFocusMode]);

  const remaining = formatRemaining(getRemainingMs(state, now));

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-background p-6 outline-none"
    >
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-4 right-4 gap-1.5 text-muted-foreground"
        onClick={closeFocusMode}
      >
        <Minimize2 />
        Exit
      </Button>

      <span className={cn("text-lg font-medium tracking-wide uppercase", phaseTextClass(state.phase))}>
        {PHASE_LABELS[state.phase]}
      </span>

      <ProgressRing
        progress={getProgress(state, settings, now)}
        phase={state.phase}
        strokeWidth={3}
        className="size-[min(80vw,65vh)]"
      >
        <span
          className="font-mono text-[min(16vw,13vh)] leading-none font-medium tabular-nums"
          aria-live="off"
        >
          {remaining}
        </span>
        <span className={cn("mt-3 text-sm text-muted-foreground", state.status !== "paused" && "invisible")}>
          Paused
        </span>
      </ProgressRing>

      <SessionDots className="[&>span]:size-2.5" />
      <TimerControls size="lg" />
      <p className="text-xs text-muted-foreground">Space to start/pause · Esc to exit</p>
    </div>,
    document.body
  );
}
