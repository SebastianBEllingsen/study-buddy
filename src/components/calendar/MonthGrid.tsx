"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { EventInfoTooltip } from "@/components/EventInfoTooltip";
import { prefersReducedMotion } from "@/lib/motion";
import { addDays, addMonths, dateKey, monthGridRange, sameDay, startOfMonth, type CalendarEvent } from "./shared";

// Deterministic per-source color for a feed-sourced event's indicator dot —
// see the identical helper in page.tsx's UpcomingEventsWidget for why
// (hashing avoids hand-assigning a color to every feed a viewer might add).
const SOURCE_DOT_COLORS = ["bg-focus", "bg-amber", "bg-sage"];
function sourceDotColor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0;
  return SOURCE_DOT_COLORS[Math.abs(hash) % SOURCE_DOT_COLORS.length];
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A real in-app month grid, not Google's embeddable widget: that widget
// only renders anything once the *viewing browser* has its own separate
// signed-in Google session (it uses calendar.google.com's cookies, not this
// app's OAuth connection) and Google refuses to let you sign in inside the
// iframe at all — it bounces out to a new window instead. It's also
// cross-origin, so it can never support in-place editing or pick up this
// app's theme. Building the grid ourselves fixes all three: it always
// works once this app is connected, editing is real, and it's just our own
// themed components.
export function MonthGrid({
  events,
  onDayClick,
  onEventClick,
  initialMonth,
  highlightEventId,
  renderEvent,
  hideHeader,
}: {
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  // Arriving from the Upcoming widget's "?date=" — jumps straight to that
  // event's month instead of always opening on the current one.
  initialMonth?: Date;
  // Arriving from the Upcoming widget's "?highlight=" — scrolled into view
  // and flashed once the matching event chip exists in the DOM, the same
  // navigate-and-highlight idea search results already use
  // (lib/scrollToHighlight.ts), just matched by element id instead of a
  // text search since a calendar event has a stable id to target directly.
  highlightEventId?: string;
  // Overrides the default feed chip — a feed's own tab uses this to draw
  // its course-coloured chips instead of the generic grey one.
  renderEvent?: (event: CalendarEvent) => React.ReactNode;
  // For a caller with its own month navigation (a feed's own tab), which
  // then drives the shown month through initialMonth + a key.
  hideHeader?: boolean;
}) {
  const [month, setMonth] = useState(() => startOfMonth(initialMonth ?? new Date()));
  const today = new Date();

  useEffect(() => {
    if (!highlightEventId) return;
    const el = document.querySelector(`[data-event-id="${CSS.escape(highlightEventId)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    el.classList.add("ring-2", "ring-focus");
    const timeout = setTimeout(() => el.classList.remove("ring-2", "ring-focus"), 1500);
    return () => clearTimeout(timeout);
  }, [highlightEventId]);

  const days = useMemo(() => {
    const { start } = monthGridRange(month);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      // All-day event dates are plain "YYYY-MM-DD" strings — using them
      // directly (rather than `new Date(event.start)`, which parses as UTC
      // midnight) avoids shifting the event a day in negative-UTC zones.
      const key = event.allDay ? event.start : dateKey(new Date(event.start));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  return (
    <div className="overflow-hidden rounded-xl border">
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
          <span className="font-heading text-sm font-semibold">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1.5">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = dateKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = sameDay(d, today);
          const dayEvents = eventsByDay.get(key) ?? [];
          let visible = dayEvents.slice(0, 3);
          // A highlighted event past the 3-visible cutoff would otherwise
          // never render as a chip at all, so the scroll-to-it effect above
          // would have nothing to find — always keep it in the visible set.
          if (highlightEventId && !visible.some((e) => e.id === highlightEventId)) {
            const target = dayEvents.find((e) => e.id === highlightEventId);
            if (target) visible = [target, ...visible.slice(0, 2)];
          }
          const overflow = dayEvents.length - visible.length;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onDayClick(d)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onDayClick(d);
              }}
              className={cn(
                "min-h-[92px] cursor-pointer border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0 hover:bg-muted/40",
                !inMonth && "bg-muted/20"
              )}
            >
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-xs",
                  !inMonth && "text-muted-foreground",
                  isToday && "bg-focus font-medium text-background"
                )}
              >
                {d.getDate()}
              </span>
              <div className="mt-1 space-y-0.5">
                {/* Feed-sourced events (see lib/calendarFeeds.ts) are
                    someone else's calendar mirrored in read-only — editing
                    a Mine Studier lecture or a Canvas assignment through
                    this app makes no sense the way editing your own Google
                    event does, so these render inert, with a muted tint
                    instead of the focus color that signals "yours, click
                    to edit". */}
                {visible.map((event) =>
                  renderEvent ? (
                    <Fragment key={event.id}>{renderEvent(event)}</Fragment>
                  ) : event.source === "google" ? (
                    <EventInfoTooltip key={event.id} event={event}>
                      <button
                        type="button"
                        data-event-id={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className="block w-full truncate rounded-md border border-focus/20 bg-focus/10 px-1 py-0.5 text-left text-[11px] text-focus hover:bg-focus/20"
                      >
                        {event.title}
                      </button>
                    </EventInfoTooltip>
                  ) : (
                    <EventInfoTooltip key={event.id} event={event}>
                      <div
                        data-event-id={event.id}
                        className="flex items-center gap-1 truncate rounded-md border border-border bg-muted px-1 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${sourceDotColor(event.source)}`} />
                        <span className="truncate">{event.title}</span>
                      </div>
                    </EventInfoTooltip>
                  )
                )}
                {overflow > 0 && <p className="px-1 text-[10px] text-muted-foreground">+{overflow} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
