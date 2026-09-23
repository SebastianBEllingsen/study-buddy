"use client";

import { useState } from "react";
import { ArrowLeft, Maximize2, Settings2, Timer } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MAX_PHASE_MINUTES,
  MAX_SESSIONS_BEFORE_LONG_BREAK,
  PHASE_LABELS,
  formatRemaining,
  getProgress,
  getRemainingMs,
  type PomodoroSettings,
} from "@/lib/pomodoro";
import { usePomodoro } from "./PomodoroProvider";
import { ProgressRing, SessionDots, TimerControls, phaseBgClass, phaseTextClass } from "./PomodoroParts";

// Header entry point. Idle it's just an icon, like its Chat/Settings
// neighbors; once a session is going it becomes a small live countdown chip
// so the time is visible from every page without opening anything.
export default function PomodoroButton() {
  const { hydrated, state, now, focusModeOpen } = usePomodoro();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"timer" | "settings">("timer");
  const active = hydrated && state.status !== "idle";

  return (
    <Popover
      open={open && !focusModeOpen}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setView("timer");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size={active ? "sm" : "icon-sm"}
            className={cn(active && "gap-1.5 px-2 font-mono tabular-nums")}
          />
        }
        aria-label={active ? `Pomodoro timer: ${formatRemaining(getRemainingMs(state, now))} left` : "Pomodoro timer"}
      >
        {active ? (
          <>
            <span
              className={cn(
                "size-2 rounded-full",
                phaseBgClass(state.phase),
                state.status === "running" ? "animate-pulse" : "opacity-50"
              )}
            />
            <span className={cn(state.status === "paused" && "text-muted-foreground")}>
              {formatRemaining(getRemainingMs(state, now))}
            </span>
          </>
        ) : (
          <Timer className="size-4 text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-4">
        {view === "timer" ? (
          <TimerView onSettings={() => setView("settings")} onFocusMode={() => setOpen(false)} />
        ) : (
          <SettingsView onBack={() => setView("timer")} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function TimerView({ onSettings, onFocusMode }: { onSettings: () => void; onFocusMode: () => void }) {
  const { state, settings, now, openFocusMode } = usePomodoro();
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center justify-between">
        <span className={cn("text-sm font-medium", phaseTextClass(state.phase))}>{PHASE_LABELS[state.phase]}</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Fullscreen focus mode"
            onClick={() => {
              onFocusMode();
              openFocusMode();
            }}
          >
            <Maximize2 />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Timer settings" onClick={onSettings}>
            <Settings2 />
          </Button>
        </div>
      </div>
      <ProgressRing progress={getProgress(state, settings, now)} phase={state.phase} className="size-40">
        <span className="font-mono text-4xl font-medium tabular-nums">{formatRemaining(getRemainingMs(state, now))}</span>
        {state.status === "paused" && <span className="text-xs text-muted-foreground">Paused</span>}
      </ProgressRing>
      <SessionDots />
      <TimerControls />
    </div>
  );
}

// Number field that lets you clear it and type freely; the value is only
// committed (clamped) once it parses, and snaps back to the saved value on blur.
function NumberSetting({
  label,
  suffix,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? String(value)}
          className="h-7 w-16 text-right"
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n) && n >= min) onChange(n);
          }}
          onBlur={() => setDraft(null)}
        />
        <span className="w-6">{suffix}</span>
      </span>
    </label>
  );
}

function ToggleSetting({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

function SettingsView({ onBack }: { onBack: () => void }) {
  const { settings, updateSettings } = usePomodoro();
  const set = <K extends keyof PomodoroSettings>(key: K) => (v: PomodoroSettings[K]) => updateSettings({ [key]: v });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-xs" aria-label="Back to timer" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <span className="text-sm font-medium">Timer settings</span>
      </div>
      <div className="space-y-2">
        <NumberSetting label="Focus" suffix="min" value={settings.focusMinutes} min={1} max={MAX_PHASE_MINUTES} onChange={set("focusMinutes")} />
        <NumberSetting label="Short break" suffix="min" value={settings.shortBreakMinutes} min={1} max={MAX_PHASE_MINUTES} onChange={set("shortBreakMinutes")} />
        <NumberSetting label="Long break" suffix="min" value={settings.longBreakMinutes} min={1} max={MAX_PHASE_MINUTES} onChange={set("longBreakMinutes")} />
        <NumberSetting
          label="Sessions until long break"
          suffix=""
          value={settings.sessionsBeforeLongBreak}
          min={1}
          max={MAX_SESSIONS_BEFORE_LONG_BREAK}
          onChange={set("sessionsBeforeLongBreak")}
        />
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-2.5">
        <ToggleSetting label="Start breaks automatically" checked={settings.autoStartBreaks} onChange={set("autoStartBreaks")} />
        <ToggleSetting label="Start focus automatically after a break" checked={settings.autoStartFocus} onChange={set("autoStartFocus")} />
        <ToggleSetting label="Chime when a phase ends" checked={settings.sound} onChange={set("sound")} />
      </div>
      <p className="text-xs text-muted-foreground">If a timer is running, new lengths apply from the next phase.</p>
    </div>
  );
}
