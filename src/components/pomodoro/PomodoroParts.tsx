"use client";

import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { PomodoroPhase } from "@/lib/pomodoro";
import { usePomodoro } from "./PomodoroProvider";

// Focus reads as the tomato (clay), breaks as calm (sage) — both are
// per-theme tokens in globals.css, so every appearance theme recolors them.
export function phaseTextClass(phase: PomodoroPhase): string {
  return phase === "focus" ? "text-clay" : "text-sage";
}

export function phaseBgClass(phase: PomodoroPhase): string {
  return phase === "focus" ? "bg-clay" : "bg-sage";
}

export function ProgressRing({
  progress,
  phase,
  className,
  strokeWidth = 6,
  children,
}: {
  progress: number;
  phase: PomodoroPhase;
  className?: string;
  strokeWidth?: number;
  children?: React.ReactNode;
}) {
  const r = 50 - strokeWidth / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("relative grid place-items-center", className)}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress)}
          className={cn("stroke-current transition-[stroke-dashoffset] duration-300 ease-linear", phaseTextClass(phase))}
        />
      </svg>
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  );
}

// One dot per focus session in the cycle; filled = done.
export function SessionDots({ className }: { className?: string }) {
  const { settings, state } = usePomodoro();
  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      aria-label={`${state.cycleCount} of ${settings.sessionsBeforeLongBreak} focus sessions done`}
    >
      {Array.from({ length: settings.sessionsBeforeLongBreak }, (_, i) => (
        <span
          key={i}
          className={cn("size-2 rounded-full", i < state.cycleCount ? phaseBgClass("focus") : "bg-muted-foreground/25")}
        />
      ))}
    </div>
  );
}

export function TimerControls({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { state, start, pause, reset, skip } = usePomodoro();
  const running = state.status === "running";
  const big = size === "lg";
  const iconBtn = big ? "icon-lg" : "icon-sm";
  const iconBtnClass = big ? "size-12 rounded-full" : undefined;
  return (
    <div className={cn("flex items-center justify-center", big ? "gap-4" : "gap-2")}>
      <Button variant="ghost" size={iconBtn} aria-label="Reset" className={iconBtnClass} onClick={reset} disabled={state.status === "idle"}>
        <RotateCcw className={big ? "size-5" : undefined} />
      </Button>
      <Button
        size={big ? "lg" : "sm"}
        className={cn(big ? "h-12 min-w-36 gap-2 rounded-full text-base" : "min-w-24")}
        onClick={running ? pause : start}
      >
        {running ? <Pause className={big ? "size-5" : undefined} /> : <Play className={big ? "size-5" : undefined} />}
        {running ? "Pause" : state.status === "paused" ? "Resume" : "Start"}
      </Button>
      <Button variant="ghost" size={iconBtn} aria-label="Skip to next phase" className={iconBtnClass} onClick={skip}>
        <SkipForward className={big ? "size-5" : undefined} />
      </Button>
    </div>
  );
}
