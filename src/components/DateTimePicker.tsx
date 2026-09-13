"use client";

import { useState } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight, ClockIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Constructs in local time (new Date(y, m, d)) rather than `new
// Date("YYYY-MM-DD")`, which the spec parses as UTC midnight — on the
// western side of UTC that renders as the previous day.
function parseDateOnly(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// 6 weeks of 7 days, starting on the Sunday on/before the 1st — a fixed
// 42-cell grid so the popup's height never jumps between months.
function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function formatTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Every 15 minutes across a day — a fine enough grain for calendar events,
// and short enough to stay a single scrollable list rather than needing an
// hour/minute two-column picker.
const TIME_SLOTS = Array.from({ length: 96 }, (_, i) => {
  const totalMinutes = i * 15;
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
});

// A themed, type-to-filter replacement for native <input type="time">. Its
// text field already follows the app's theme, but on most platforms
// clicking it opens an OS-native spinner/clock control that CSS can't
// restyle — same limitation as the date input above. A filterable combobox
// (the same pattern Google Calendar's own event editor uses) is also just
// faster than either a native picker or a plain scroll list: typing "9"
// jumps straight to 9-something instead of scrolling past 36 half-hour
// slots to get there.
function TimePicker({ value, onChange, id }: { value: string; onChange: (value: string) => void; id?: string }) {
  return (
    <Combobox items={TIME_SLOTS} value={value || null} onValueChange={(v) => v && onChange(v)} itemToStringLabel={formatTimeLabel}>
      <ComboboxInputGroup className="w-[8rem] shrink-0">
        <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <ComboboxInput id={id} placeholder="Time" className="tabular-nums" />
        <ComboboxIcon />
      </ComboboxInputGroup>
      <ComboboxPopup className="max-h-60 w-[8rem]">
        <ComboboxEmpty>No match</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item} className="tabular-nums">
              {formatTimeLabel(item)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

// A themed replacement for native <input type="date">/"datetime-local">.
// Those inputs' text field already follows the app's theme fine, but the
// popup calendar they open to pick a day is rendered by the browser/OS
// itself — no CSS can restyle it, on any browser. This renders its own
// month-grid popover instead (the same visual language as the /calendar
// page's own month view), so date selection matches every other themed
// surface instead of falling back to unthemed OS chrome.
export function DateTimePicker({
  value,
  onChange,
  mode,
  id,
}: {
  // "date" mode: value/onChange are a plain "YYYY-MM-DD" string, matching
  // <input type="date">. "datetime" mode: "YYYY-MM-DDTHH:mm" local time,
  // matching <input type="datetime-local">.
  value: string;
  onChange: (value: string) => void;
  mode: "date" | "datetime";
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [datePart, timePart] = mode === "datetime" ? value.split("T") : [value, ""];
  const selected = parseDateOnly(datePart);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected ?? new Date()));

  function commitDate(d: Date) {
    const nextDatePart = formatDateOnly(d);
    onChange(mode === "datetime" ? `${nextDatePart}T${timePart || "09:00"}` : nextDatePart);
    setOpen(false);
  }

  const today = new Date();

  return (
    <div className="flex gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setViewMonth(startOfMonth(selected ?? new Date()));
        }}
      >
        <PopoverTrigger
          render={<Button type="button" variant="outline" id={id} className="min-w-0 flex-1 justify-start font-normal" />}
        >
          <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {selected
              ? selected.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
              : "Pick a date"}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium">
              {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="py-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {monthGrid(viewMonth).map((d) => {
              const inMonth = d.getMonth() === viewMonth.getMonth();
              const isSelected = selected && sameDay(d, selected);
              const isToday = sameDay(d, today);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => commitDate(d)}
                  className={cn(
                    "mx-auto flex size-8 items-center justify-center rounded-full text-sm transition-colors hover:bg-muted",
                    !inMonth && "text-muted-foreground/50",
                    isToday && !isSelected && "ring-1 ring-inset ring-focus",
                    isSelected && "bg-focus font-medium text-white hover:bg-focus"
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {mode === "datetime" && (
        <TimePicker value={timePart} onChange={(t) => onChange(`${datePart}T${t}`)} />
      )}
    </div>
  );
}
