"use client";

import { useEffect } from "react";
import { cn } from "cn";
import { PHASE_LABELS, formatRemaining, getProgress, getRemainingMs } from "@/lib/pomodoro";
import { usePomodoro } from "@/components/pomodoro/PomodoroProvider";
import { ProgressRing, SessionDots, TimerControls, phaseTextClass } from "@/components/pomodoro/PomodoroParts";

// The Pomodoro timer popped out into its own small window (see
// PomodoroButton's Detach), to keep beside whatever you're studying. It's
// the same timer, not a copy: PomodoroProvider keeps every open window in
// sync through localStorage, so start/pause/skip here or in the main
// window show up in both. Covers the root layout's header like the other
// detached windows; Space starts/pauses, as in focus mode.
export default function DetachedPomodoroPage() {
  const { hydrated, state, settings, now, start, pause } = usePomodoro();
  const running = state.status === "running";

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (running) pause();
        else start();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, start, pause]);

  return (
    <div
      data-slot="detached-page"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-4"
    >
      {hydrated && (
        <>
          <span className={cn("text-sm font-medium", phaseTextClass(state.phase))}>{PHASE_LABELS[state.phase]}</span>
          <ProgressRing
            progress={getProgress(state, settings, now)}
            phase={state.phase}
            className="size-[min(78vw,58vh)]"
          >
            <span className="font-mono text-[min(15vw,11vh)] leading-none font-medium tabular-nums">
              {formatRemaining(getRemainingMs(state, now))}
            </span>
            <span className={cn("mt-2 text-xs text-muted-foreground", state.status !== "paused" && "invisible")}>
              Paused
            </span>
          </ProgressRing>
          <SessionDots />
          <TimerControls />
        </>
      )}
    </div>
  );
}
