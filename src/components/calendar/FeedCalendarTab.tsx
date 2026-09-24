"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { cn } from "cn";
import type { CalendarFeed } from "@/lib/models";
import { PALETTE, parseFeedCalendarConfig } from "@/lib/feedCalendar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthGrid } from "./MonthGrid";
import { FeedCalendarSettings } from "./FeedCalendarSettings";
import { courseDisplay, FeedEventPopover, FeedWeekView } from "./FeedWeekView";
import { addDays, monthGridRange, startOfMonth, startOfWeek, type CalendarEvent } from "./shared";

function weekLabel(weekStart: Date, days: number): string {
  const end = addDays(weekStart, days - 1);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const startStr = weekStart.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  const endStr = end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

// One feed's own /calendar tab: that feed only (no Google, no other feeds),
// as a timetable week grid or the shared month grid, with its own
// per-course colours/aliases and display settings.
export function FeedCalendarTab({ feed }: { feed: CalendarFeed }) {
  const config = useMemo(() => parseFeedCalendarConfig(feed.calendar_config), [feed.calendar_config]);
  const [view, setView] = useState<"week" | "month">(config.defaultView);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Fetched per visible range, not the whole year ahead the shared views
  // load — the week view needs past days (Monday of this week, last week),
  // which the default now-onward window never includes.
  const range = view === "week" ? { start: weekStart, end: addDays(weekStart, 7) } : monthGridRange(month);
  const key = `/api/calendar/events?feedId=${feed.id}&maxResults=1000&timeMin=${encodeURIComponent(
    range.start.toISOString()
  )}&timeMax=${encodeURIComponent(range.end.toISOString())}`;
  const { data, error } = useSWR<{ events: CalendarEvent[] }>(key, { keepPreviousData: true });
  const events = data?.events ?? null;

  const courseCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const event of events ?? []) {
      const { code } = courseDisplay(event, config);
      if (code) codes.add(code);
    }
    return [...codes];
  }, [events, config]);

  const dayCount = config.showWeekends ? 7 : 5;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            onClick={() => (view === "week" ? setWeekStart(addDays(weekStart, -7)) : setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setWeekStart(startOfWeek(new Date()));
              setMonth(startOfMonth(new Date()));
            }}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={view === "week" ? "Next week" : "Next month"}
            onClick={() => (view === "week" ? setWeekStart(addDays(weekStart, 7)) : setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-1 font-heading text-sm font-semibold">
            {view === "week"
              ? weekLabel(weekStart, dayCount)
              : month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  view === v ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Calendar settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      {error instanceof Error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {events === null && !error && <Skeleton className="h-[600px] rounded-xl" />}

      {events && view === "week" && <FeedWeekView events={events} weekStart={weekStart} config={config} />}

      {events && view === "month" && (
        <MonthGrid
          // Keyed by month so its internal month state follows this tab's
          // own toolbar, which replaces MonthGrid's header here.
          key={month.toISOString()}
          events={events}
          initialMonth={month}
          hideHeader
          onEventClick={() => {}}
          // Clicking a day jumps to that day's week.
          onDayClick={(date) => {
            setWeekStart(startOfWeek(date));
            setView("week");
          }}
          renderEvent={(event) => {
            const display = courseDisplay(event, config);
            const palette = PALETTE[display.color];
            return (
              <FeedEventPopover
                event={event}
                display={display}
                trigger={
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="block w-full overflow-hidden rounded-[4px] border px-1 py-0.5 text-left text-[11px] whitespace-nowrap text-[#1f2328]"
                    style={{ backgroundColor: palette.bg, borderColor: palette.border }}
                  >
                    {display.label && `${display.label} `}
                    <b>{display.type}</b>
                  </button>
                }
              />
            );
          }}
        />
      )}

      <FeedCalendarSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        feedId={feed.id}
        feedLabel={feed.label}
        config={config}
        courseCodes={courseCodes}
      />
    </div>
  );
}
