"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowUpRight, CalendarCheck, CalendarClock, MapPin } from "lucide-react";
import { cn } from "cn";
import type { CalendarFeed } from "@/lib/models";
import { layoutDayEvents, PALETTE, parseFeedCalendarConfig, shortLocation, type FeedCalendarConfig } from "@/lib/feedCalendar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { courseDisplay, FeedEventPopover, hhmm, TODAY_ACCENT, type CourseDisplay } from "./FeedWeekView";
import { addDays, dateKey, type CalendarEvent } from "./shared";

// How far ahead the widget looks for the next class day — far enough to
// bridge a weekend or a short break without fetching a whole semester.
const LOOKAHEAD_DAYS = 8;

interface Item {
  event: CalendarEvent;
  display: CourseDisplay;
  start: Date;
  end: Date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayLabel(day: Date, today: Date): string {
  const diff = Math.round((startOfDay(day).getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return day.toLocaleDateString(undefined, { weekday: "long" });
}

function untilLabel(from: Date, to: Date): string {
  const minutes = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${h} h${m ? ` ${m} min` : ""}`;
}

function roomOf(event: CalendarEvent): string {
  return event.location ? shortLocation(event.location).text : "";
}

// The days the widget can show, each with its timed events in order:
// `focus` is today while any of today's classes are still to come (or
// running), otherwise the next day that has anything; `after` is the class
// day following it (the second column at full width).
function useTimetableDays(events: CalendarEvent[] | null, config: FeedCalendarConfig, now: Date) {
  return useMemo(() => {
    if (!events) return null;
    const byDay = new Map<string, Item[]>();
    for (const event of events) {
      if (event.allDay) continue;
      const start = new Date(event.start);
      const item = { event, display: courseDisplay(event, config), start, end: new Date(event.end) };
      const key = dateKey(start);
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    const days = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, items]) => ({ day: startOfDay(items[0].start), items: items.sort((a, b) => a.start.getTime() - b.start.getTime()) }));
    const todayKey = dateKey(now);
    const focusIndex = days.findIndex(
      (d) => dateKey(d.day) > todayKey || (dateKey(d.day) === todayKey && d.items.some((i) => i.end > now))
    );
    return {
      focus: focusIndex === -1 ? null : days[focusIndex],
      after: focusIndex === -1 ? null : (days[focusIndex + 1] ?? null),
    };
  }, [events, config, now]);
}

// The event running right now, else the next one to start.
function currentOrNext(items: Item[], now: Date): { item: Item; running: boolean } | null {
  const running = items.find((i) => i.start <= now && i.end > now);
  if (running) return { item: running, running: true };
  const next = items.find((i) => i.start > now);
  return next ? { item: next, running: false } : null;
}

function CoursePill({ display, className }: { display: CourseDisplay; className?: string }) {
  const palette = PALETTE[display.color];
  if (!display.label) return null;
  return (
    <span
      className={cn(
        // No text-shadow: transparent-widget mode adds one for text over the
        // backdrop, which only smudges dark text on a solid pastel fill.
        "inline-flex shrink-0 items-center rounded-[4px] border px-1.5 text-[11px] font-medium text-[#1f2328] [text-shadow:none]",
        className
      )}
      style={{ backgroundColor: palette.bg, borderColor: palette.border }}
    >
      {display.label}
    </span>
  );
}

function StatusText({ item, running, now, today }: { item: Item; running: boolean; now: Date; today: Date }) {
  if (running) {
    return (
      <span className="font-medium" style={{ color: TODAY_ACCENT }}>
        Now · until {hhmm(item.end)}
      </span>
    );
  }
  const sameDay = dateKey(item.start) === dateKey(today);
  return (
    <span>{sameDay ? untilLabel(now, item.start) : `${dayLabel(item.start, today)} ${hhmm(item.start)}`}</span>
  );
}

// A dashboard glance at a feed's own timetable (see FeedCalendarTab) —
// uses the same per-course colours/aliases as that tab, and adapts to its
// tile size: a "next class" card when narrow, a horizontal day timeline
// when one row tall, and the day's agenda (plus the following class day at
// full width) when there's room.
export default function TimetableWidget({
  layout,
  label,
  transparent,
}: {
  layout: { colSpan: number; rowSpan: number };
  label?: string;
  transparent: boolean;
}) {
  const { data: feedsData } = useSWR<{ feeds: CalendarFeed[] }>("/api/calendar-feeds");
  // The first feed with its own tab — the one a "my timetable" widget
  // almost always means. More than one own-tab feed is rare enough not to
  // warrant a per-widget picker.
  const feed = feedsData?.feeds.find((f) => f.own_calendar && f.enabled) ?? null;
  const config = useMemo(() => parseFeedCalendarConfig(feed?.calendar_config ?? null), [feed?.calendar_config]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);
  const today = startOfDay(now);

  // Keyed by the calendar day, so it's one cached fetch per day rather than
  // a new request every tick of `now`.
  const todayKey = dateKey(today);
  const key = feed
    ? `/api/calendar/events?feedId=${feed.id}&maxResults=1000&timeMin=${encodeURIComponent(
        new Date(`${todayKey}T00:00:00`).toISOString()
      )}&timeMax=${encodeURIComponent(addDays(new Date(`${todayKey}T00:00:00`), LOOKAHEAD_DAYS).toISOString())}`
    : null;
  const { data, error } = useSWR<{ events: CalendarEvent[] }>(key);
  const days = useTimetableDays(data?.events ?? null, config, now);

  const compact = layout.colSpan <= 2;
  const strip = !compact && layout.rowSpan === 1;
  const href = feed ? `/calendar?view=feed-${feed.id}` : "/calendar";
  const title = label ?? feed?.label ?? "Timetable";
  const cardClass = transparent ? "" : "bg-card ring-1 ring-foreground/10";
  // Mostly small grey text — needs more than the shared halo over a
  // bright patch of backdrop (see .backdrop-legible in globals.css).
  const legibleClass = transparent ? "backdrop-legible" : "";

  if (feedsData && !feed) {
    return (
      <Card
        elevation={transparent ? "flat" : "raised"}
        className="h-full items-center justify-center gap-1 overflow-hidden p-3 text-center"
      >
        <CalendarClock className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {compact ? "No timetable" : "Tick “Own tab” on a calendar feed in Settings to see its timetable here."}
        </p>
      </Card>
    );
  }

  const loading = !error && (!feedsData || !days);
  const errorText = error instanceof Error ? error.message : null;

  if (compact) {
    const pick = days?.focus ? currentOrNext(days.focus.items, now) : null;
    return (
      <Link
        href={href}
        className={cn("flex h-full flex-col justify-center gap-1 overflow-hidden rounded-xl p-3", cardClass, legibleClass, "hover:bg-muted/30")}
      >
        {loading && <Skeleton className="h-10 w-full rounded" />}
        {errorText && <p className="text-xs text-destructive">{errorText}</p>}
        {!loading && !errorText && !pick && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-4" />
            No classes coming up
          </p>
        )}
        {pick && (
          <>
            <div className="flex min-w-0 items-center gap-1">
              <CoursePill display={pick.item.display} />
            </div>
            <p className="truncate text-sm font-semibold">{pick.item.display.type || pick.item.event.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              <StatusText item={pick.item} running={pick.running} now={now} today={today} />
            </p>
            {layout.rowSpan > 1 && roomOf(pick.item.event) && (
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" />
                {roomOf(pick.item.event)}
              </p>
            )}
          </>
        )}
      </Link>
    );
  }

  const focus = days?.focus ?? null;
  const pick = focus ? currentOrNext(focus.items, now) : null;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl", cardClass, legibleClass)}>
      <div className={cn("flex shrink-0 items-center gap-2 px-4", strip ? "pt-2.5 pb-1" : "py-2.5", !strip && !transparent && "border-b")}>
        <span className="flex shrink-0 items-center gap-1.5 font-heading text-sm font-semibold">
          <CalendarClock className="size-4 text-focus" />
          {title}
        </span>
        {/* One-row tiles have no room for a list, so the header carries
            the "what's on now / next" line instead. */}
        {strip && pick && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="text-muted-foreground/50">·</span>
            <CoursePill display={pick.item.display} />
            <span className="truncate font-medium text-foreground">{pick.item.display.type}</span>
            <span className="shrink-0">
              <StatusText item={pick.item} running={pick.running} now={now} today={today} />
            </span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {focus && (
            <span className="text-xs text-muted-foreground">{dayLabel(focus.day, today)}</span>
          )}
          <Link href={href} aria-label="Open timetable" className="text-muted-foreground hover:text-foreground">
            <ArrowUpRight className="size-4" />
          </Link>
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {loading && (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 rounded-md" />
            {!strip && <Skeleton className="h-8 rounded-md" />}
          </div>
        )}
        {errorText && <p className="px-4 py-3 text-sm text-destructive">{errorText}</p>}
        {!loading && !errorText && !focus && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No classes in the coming week.</p>
        )}
        {focus &&
          (strip ? (
            <DayTimeline items={focus.items} day={focus.day} now={now} config={config} />
          ) : (
            <div className={cn("grid h-full", layout.colSpan >= 6 && days?.after && "grid-cols-2 divide-x")}>
              <DayAgenda
                items={focus.items}
                now={now}
                transparent={transparent}
                heading={layout.colSpan >= 6 && days?.after ? dayLabel(focus.day, today) : null}
              />
              {layout.colSpan >= 6 && days?.after && (
                <DayAgenda items={days.after.items} now={now} transparent={transparent} heading={dayLabel(days.after.day, today)} />
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

// One row tall: the day as a horizontal track, blocks placed by time in
// their course colours, with the now-marker sweeping across it.
function DayTimeline({ items, day, now, config }: { items: Item[]; day: Date; now: Date; config: FeedCalendarConfig }) {
  const minutesOf = (d: Date) => (d.getTime() - day.getTime()) / 60_000;
  const first = Math.min(config.hourStart * 60, ...items.map((i) => Math.floor(minutesOf(i.start) / 60) * 60));
  const last = Math.max(config.hourEnd * 60, ...items.map((i) => Math.ceil(minutesOf(i.end) / 60) * 60));
  const span = last - first;
  const pct = (minutes: number) => ((minutes - first) / span) * 100;

  // Overlapping classes share the track by splitting its height — the
  // same lane packing the week view uses for widths.
  const boxes = new Map(
    layoutDayEvents(items.map((i) => ({ id: i.event.id, start: minutesOf(i.start), end: minutesOf(i.end) }))).map((b) => [b.id, b])
  );
  const isToday = dateKey(day) === dateKey(now);
  const nowPct = pct(minutesOf(now));
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => first / 60 + i);
  const labelEvery = hours.length > 10 ? 2 : 1;

  return (
    <div className="px-4 pt-1.5">
      <div className="relative h-11 rounded-md bg-muted/40">
        {hours.slice(1, -1).map((h) => (
          <span key={h} className="absolute inset-y-0 w-px bg-foreground/10" style={{ left: `${pct(h * 60)}%` }} />
        ))}
        {items.map(({ event, display, start, end }) => {
          const box = boxes.get(event.id);
          if (!box) return null;
          const palette = PALETTE[display.color];
          const past = isToday && end <= now;
          return (
            <FeedEventPopover
              key={event.id}
              event={event}
              display={display}
              trigger={
                <button
                  type="button"
                  className={cn(
                    "absolute flex items-center overflow-hidden rounded-[4px] border px-1 text-left text-[11px] leading-tight font-medium whitespace-nowrap text-[#1f2328] [text-shadow:none] hover:brightness-95",
                    past && "opacity-45"
                  )}
                  style={{
                    left: `calc(${pct(minutesOf(start))}% + 1px)`,
                    width: `calc(${pct(minutesOf(end)) - pct(minutesOf(start))}% - 2px)`,
                    top: `calc(${box.left}% + 2px)`,
                    height: `calc(${box.width}% - 4px)`,
                    zIndex: box.z,
                    backgroundColor: palette.bg,
                    borderColor: palette.border,
                  }}
                >
                  {display.deadline && <CalendarCheck className="mr-0.5 size-3 shrink-0" />}
                  {display.label ?? display.type}
                </button>
              }
            />
          );
        })}
        {isToday && nowPct >= 0 && nowPct <= 100 && (
          <span aria-hidden className="pointer-events-none absolute -inset-y-1 z-20 w-0.5 rounded-full" style={{ left: `${nowPct}%`, backgroundColor: TODAY_ACCENT }}>
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full" style={{ backgroundColor: TODAY_ACCENT }} />
          </span>
        )}
      </div>
      <div className="relative mt-0.5 h-3.5 text-[10px] text-muted-foreground tabular-nums">
        {hours
          .filter((h) => (h - first / 60) % labelEvery === 0)
          .map((h, i, all) => (
            <span
              key={h}
              className={cn("absolute", i === 0 ? "" : i === all.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
              style={{ left: `${pct(h * 60)}%` }}
            >
              {String(h % 24).padStart(2, "0")}
            </span>
          ))}
      </div>
    </div>
  );
}

// Two+ rows tall: the day as an agenda — finished classes faded, the one
// running now tinted in its course colour with a progress bar, and a
// countdown on the next one.
function DayAgenda({
  items,
  now,
  heading,
  transparent,
}: {
  items: Item[];
  now: Date;
  heading: string | null;
  transparent: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusId = currentOrNext(items, now)?.item.event.id;

  // Lands on what's relevant now instead of the day's first (possibly long
  // finished) class — scrolled within the widget, never the page.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-agenda-id="${CSS.escape(focusId ?? "")}"]`);
    if (container && target) container.scrollTop = Math.max(0, target.offsetTop - 4);
  }, [focusId]);

  return (
    <div ref={scrollRef} className="scrollbar-hover relative h-full min-h-0 overflow-y-auto">
      {heading && (
        <p className="px-4 pt-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {heading}
        </p>
      )}
      <ul className="space-y-0.5 p-1.5">
        {items.map((item) => {
          const { event, display, start, end } = item;
          const palette = PALETTE[display.color];
          const running = start <= now && end > now;
          const past = end <= now;
          // A countdown only makes sense for later today — tomorrow's first
          // class "in 17 h" is noise.
          const upNext = !running && event.id === focusId && dateKey(start) === dateKey(now);
          const progress = running ? ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100 : 0;
          const room = roomOf(event);
          return (
            <li key={event.id} data-agenda-id={event.id}>
              <FeedEventPopover
                event={event}
                display={display}
                trigger={
                  <button
                    type="button"
                    className={cn(
                      "relative flex w-full items-stretch gap-2.5 overflow-hidden rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50",
                      // Over a backdrop, fading the row fades the text's halo
                      // with it and finished classes all but vanish — so there
                      // they're greyed out instead, halo intact.
                      past && (transparent ? "text-muted-foreground" : "opacity-45")
                    )}
                    style={running ? { backgroundColor: `color-mix(in srgb, ${palette.bg} 16%, transparent)` } : undefined}
                  >
                    <span className="flex w-10 shrink-0 flex-col text-xs leading-tight tabular-nums">
                      <span className="font-semibold">{hhmm(start)}</span>
                      {!display.deadline && <span className="text-muted-foreground">{hhmm(end)}</span>}
                    </span>
                    <span
                      className={cn("w-1 shrink-0 rounded-full", past && transparent && "opacity-45")}
                      style={{ backgroundColor: palette.border }}
                    />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex items-center gap-1 text-sm">
                        {display.deadline && <CalendarCheck className="size-3.5 shrink-0 text-muted-foreground" />}
                        {display.label && <span className="shrink-0 text-muted-foreground">{display.label}</span>}
                        <span className="truncate font-medium">{display.type || event.title}</span>
                      </span>
                      {(room || display.deadline) && (
                        <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          {display.deadline ? (
                            `Due ${hhmm(start)}`
                          ) : (
                            <>
                              <MapPin className="size-3 shrink-0" />
                              {room}
                            </>
                          )}
                        </span>
                      )}
                    </span>
                    {(running || upNext) && (
                      <span
                        className={cn("shrink-0 self-center rounded-full px-2 py-0.5 text-[11px] font-medium", running && "[text-shadow:none]")}
                        style={
                          running
                            ? { backgroundColor: TODAY_ACCENT, color: "white" }
                            : { color: TODAY_ACCENT, boxShadow: `inset 0 0 0 1px ${TODAY_ACCENT}` }
                        }
                      >
                        {running ? "Now" : untilLabel(now, start)}
                      </span>
                    )}
                    {running && (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/10">
                        <span className="block h-full" style={{ width: `${progress}%`, backgroundColor: palette.border }} />
                      </span>
                    )}
                  </button>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
