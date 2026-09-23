"use client";

import type { ReactNode } from "react";
import { HelpTooltip } from "@/components/HelpTooltip";

// One on/off setting: label (with optional help) on the left, checkbox on
// the right. Every toggle in Settings uses this, so they all read alike.
export function SettingToggle({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  help?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-1.5">
        {label}
        {help && <HelpTooltip>{help}</HelpTooltip>}
      </span>
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

// Options that only apply once something above them is set up (a backdrop
// picked, the wallpaper turned on) — boxed so they read as belonging to it.
export function SettingGroup({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5 rounded-md border p-2.5">{children}</div>;
}

// A labelled range slider with its current value on the right. `onCommit`
// fires when the thumb is let go (pointer, keyboard or blur), for settings
// that save once rather than on every step.
export function SettingSlider({
  label,
  valueLabel,
  min,
  max,
  value,
  onChange,
  onCommit,
}: {
  label: ReactNode;
  valueLabel: ReactNode;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="flex justify-between">
        {label}
        <span className="text-xs tabular-nums text-muted-foreground">{valueLabel}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="w-full accent-primary"
      />
    </label>
  );
}
