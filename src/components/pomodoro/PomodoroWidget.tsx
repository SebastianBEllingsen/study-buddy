"use client";

import { Maximize2, Pause, Play, Timer } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PHASE_LABELS, formatRemaining, getProgress, getRemainingMs } from "@/lib/pomodoro";
import { usePomodoro } from "./PomodoroProvider";
import { SessionDots, TimerControls, phaseBgClass, phaseTextClass } from "./PomodoroParts";

// Dashboard view of the same timer the header runs (one shared
// PomodoroProvider, so starting it here starts it everywhere). Adapts to its
// tile size like the other widgets: a single row is a compact strip, two or
// more rows get the ring. Timer settings stay in the header popover.
export default function PomodoroWidget({
  layout,
  label,
  transparent,
}: {
  layout: { colSpan: number; rowSpan: number };
  label?: string;
  transparent: boolean;
}) {
  const { hydrated, state, settings, now, start, pause, openFocusMode } = usePomodoro();
  const border = transparent ? "" : "border";

  if (!hydrated) {
    return <Skeleton className="h-full rounded-xl" />;
  }

  const running = state.status === "running";
  const remaining = formatRemaining(getRemainingMs(state, now));
  const toggle = running ? pause : start;

  if (layout.rowSpan === 1) {
    const narrow = layout.colSpan <= 2;
    return (
      <Card
        elevation={transparent ? "flat" : "raised"}
        className={cn("h-full flex-row items-center justify-between gap-2 overflow-hidden px-4", border)}
      >
        <div className="min-w-0">
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", phaseTextClass(state.phase))}>
            <span className={cn("size-1.5 rounded-full", phaseBgClass(state.phase))} />
            {narrow ? PHASE_LABELS[state.phase].replace(" break", "") : PHASE_LABELS[state.phase]}
          </span>
          <span
            className={cn(
              "block font-mono font-medium tabular-nums",
              narrow ? "text-2xl" : "text-3xl",
              state.status === "paused" && "text-muted-foreground"
            )}
          >
            {remaining}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!narrow && (
            <Button variant="ghost" size="icon-sm" aria-label="Fullscreen focus mode" onClick={openFocusMode}>
              <Maximize2 />
            </Button>
          )}
          <Button size="icon" className="rounded-full" aria-label={running ? "Pause" : "Start"} onClick={toggle}>
            {running ? <Pause /> : <Play />}
          </Button>
        </div>
      </Card>
    );
  }

  const progress = getProgress(state, settings, now);
  const r = 46;
  const c = 2 * Math.PI * r;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl", border, !transparent && "bg-card")}>
      <div className={cn("flex shrink-0 items-center justify-between gap-2 px-4 py-2", !transparent && "border-b")}>
        <span className="flex items-center gap-1.5 font-heading text-sm font-semibold">
          <Timer className="size-4 text-clay" />
          {label ?? "Pomodoro"}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Fullscreen focus mode" onClick={openFocusMode}>
          <Maximize2 />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3">
        {/* Countdown drawn as SVG text so it scales with the ring at any
            tile size, instead of needing a font size per layout. */}
        <svg viewBox="0 0 100 100" className="min-h-0 w-full flex-1" role="img" aria-label={`${PHASE_LABELS[state.phase]}: ${remaining} left`}>
          <g transform="rotate(-90 50 50)">
            <circle cx="50" cy="50" r={r} fill="none" strokeWidth={4} className="stroke-muted" />
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - progress)}
              className={cn("stroke-current transition-[stroke-dashoffset] duration-300 ease-linear", phaseTextClass(state.phase))}
            />
          </g>
          <text
            x="50"
            y="44"
            textAnchor="middle"
            dominantBaseline="central"
            className={cn("fill-current font-mono font-medium", state.status === "paused" && "text-muted-foreground")}
            fontSize="21"
          >
            {remaining}
          </text>
          <text
            x="50"
            y="64"
            textAnchor="middle"
            dominantBaseline="central"
            className={cn("fill-current", phaseTextClass(state.phase))}
            fontSize="8"
          >
            {state.status === "paused" ? "Paused" : PHASE_LABELS[state.phase]}
          </text>
        </svg>
        {layout.rowSpan >= 3 && <SessionDots />}
        <TimerControls />
      </div>
    </div>
  );
}
