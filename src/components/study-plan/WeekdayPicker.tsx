"use client";

import { cn } from "cn";

// Monday-first, the way most study weeks are planned; values are
// Date.getUTCDay() numbers (0 = Sunday), as stored in StudyPlanOptions.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  function toggle(day: number) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  }
  return (
    <div className="flex flex-wrap gap-1">
      {WEEKDAYS.map((day) => (
        <button
          key={day.value}
          type="button"
          aria-pressed={value.includes(day.value)}
          onClick={() => toggle(day.value)}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted/60",
            value.includes(day.value) && "border-primary bg-primary/10"
          )}
        >
          {day.label}
        </button>
      ))}
    </div>
  );
}
