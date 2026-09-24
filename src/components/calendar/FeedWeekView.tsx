"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarCheck, Clock, ExternalLink, MapPin } from "lucide-react";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  autoCourseColor,
  isDeadlineEvent,
  layoutDayEvents,
  PALETTE,
  parseCourseEvent,
  shortLocation,
  type FeedCalendarConfig,
  type PaletteKey,
} from "@/lib/feedCalendar";
import { addDays, dateKey, sameDay, type CalendarEvent } from "./shared";

const HOUR_PX = 56;
// The student portal's own accent for the Today column and now-line —
// deliberately not the app's --focus, so this tab reads like the timetable
// it mirrors.
export const TODAY_ACCENT = "#6b5ce7";
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// A block's rendered height never drops below this, so a 15-minute slot
// still shows at least its course line.
const MIN_BLOCK_MINUTES = 20;
// A zero-length event (a deadline at 17:00) has no duration to draw — it
// gets an hour-tall block, the size the student portal gives its own
// assignment entries.
const ZERO_LENGTH_MINUTES = 60;

export interface CourseDisplay {
  code: string | null;
  // Alias if one is set, else the raw course code.
  label: string | null;
  type: string;
  color: PaletteKey;
  // An assignment/deadline rather than a scheduled session — drawn with a
  // check icon and "due HH:mm" instead of a time range.
  deadline: boolean;
}

export function courseDisplay(event: CalendarEvent, config: FeedCalendarConfig): CourseDisplay {
  const { code, type } = parseCourseEvent(event.title);
  const settings = code ? config.courses[code] : undefined;
  return {
    code,
    label: settings?.alias ?? code,
    type,
    color: settings?.color ?? autoCourseColor(code),
    deadline: !event.allDay && isDeadlineEvent(type, event.start, event.end),
  };
}

export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatWhen(event: CalendarEvent, deadline: boolean): string {
  const start = new Date(event.allDay ? `${event.start}T00:00:00` : event.start);
  const date = start.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  if (event.allDay) return date;
  if (deadline) return `${date} ⋅ due ${hhmm(start)}`;
  return `${date} ⋅ ${hhmm(start)} - ${hhmm(new Date(event.end))}`;
}

// The click-to-open details card for a block or chip — the same content
// as EventInfoTooltip, but it stays open so a long description can be read
// and its link clicked.
export function FeedEventPopover({
  event,
  display,
  trigger,
}: {
  event: CalendarEvent;
  display: CourseDisplay;
  trigger: React.ReactElement;
}) {
  const palette = PALETTE[display.color];
  const location = event.location ? shortLocation(event.location) : null;
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent side="right" align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3">
        <div className="flex items-start gap-2">
          <span
            className="mt-1 size-3 shrink-0 rounded-sm border"
            style={{ backgroundColor: palette.bg, borderColor: palette.border }}
          />
          <div className="min-w-0">
            {display.label && <p className="text-xs text-muted-foreground">{display.label}</p>}
            <p className="font-medium leading-snug">{display.type || event.title}</p>
          </div>
        </div>
        <div className="space-y-1.5 pl-5 text-xs text-muted-foreground">
          <div className="flex items-start gap-1.5">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            <span>{formatWhen(event, display.deadline)}</span>
          </div>
          {location?.text && (
            <div className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {event.location!.replace(/https?:\/\/\S+/g, "").trim()}
                {location.mapUrl && (
                  <>
                    {" · "}
                    <Link href={location.mapUrl} target="_blank" rel="noopener noreferrer" className="text-focus hover:underline">
                      Map
                    </Link>
                  </>
                )}
              </span>
            </div>
          )}
          {event.description && (
            <p className="max-h-40 overflow-y-auto whitespace-pre-line text-foreground/80">
              {/* Mine Studier escapes quotes as \" (not valid ICS escaping,
                  so node-ical leaves the backslash in). */}
              {event.description.replace(/\\"/g, '"')}
            </p>
          )}
          {event.htmlLink && (
            <Link
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-focus hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Open
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface PlacedEvent {
  event: CalendarEvent;
  display: CourseDisplay;
  // Minutes from the day's midnight, clipped to the day.
  start: number;
  end: number;
}

function minutesInto(day: Date, d: Date): number {
  return (d.getTime() - day.getTime()) / 60_000;
}

// A timetable-style week grid for one feed: Mon–Sun columns, an hour
// gutter, pastel course-coloured blocks, a highlighted Today column, and a
// dotted now-line.
export function FeedWeekView({
  events,
  weekStart,
  config,
}: {
  events: CalendarEvent[];
  weekStart: Date;
  config: FeedCalendarConfig;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const dayCount = config.showWeekends ? 7 : 5;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(weekStart, i)), [weekStart, dayCount]);

  const { timedByDay, allDayByDay, rangeStart, rangeEnd } = useMemo(() => {
    const timed = new Map<string, PlacedEvent[]>();
    const allDay = new Map<string, PlacedEvent[]>();
    let earliest = config.hourStart * 60;
    let latest = config.hourEnd * 60;

    for (const day of days) {
      const key = dateKey(day);
      const dayEnd = addDays(day, 1);
      for (const event of events) {
        const display = courseDisplay(event, config);
        if (event.allDay) {
          // All-day ends are exclusive "YYYY-MM-DD" dates.
          if (event.start <= key && event.end > key) {
            allDay.set(key, [...(allDay.get(key) ?? []), { event, display, start: 0, end: 0 }]);
          }
          continue;
        }
        const start = new Date(event.start);
        const end =
          event.start === event.end ? new Date(start.getTime() + ZERO_LENGTH_MINUTES * 60_000) : new Date(event.end);
        if (start >= dayEnd || end <= day) continue;
        const startMin = Math.max(0, minutesInto(day, start));
        const endMin = Math.min(24 * 60, Math.max(minutesInto(day, end), startMin + MIN_BLOCK_MINUTES));
        earliest = Math.min(earliest, Math.floor(startMin / 60) * 60);
        latest = Math.max(latest, Math.ceil(endMin / 60) * 60);
        timed.set(key, [...(timed.get(key) ?? []), { event, display, start: startMin, end: endMin }]);
      }
    }
    return { timedByDay: timed, allDayByDay: allDay, rangeStart: earliest / 60, rangeEnd: latest / 60 };
  }, [events, days, config]);

  const hours = Array.from({ length: rangeEnd - rangeStart }, (_, i) => rangeStart + i);
  const gridHeight = hours.length * HOUR_PX;
  const hasAllDay = allDayByDay.size > 0;

  // Opens scrolled to the configured start hour; anything earlier (a
  // 07:00 lab) is reachable by scrolling up rather than silently hidden.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (config.hourStart - rangeStart) * HOUR_PX;
  }, [config.hourStart, rangeStart, weekStart]);

  const todayIndex = days.findIndex((d) => sameDay(d, now));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMinutes - rangeStart * 60) * (HOUR_PX / 60);
  const showNowLine = todayIndex !== -1 && nowTop >= 0 && nowTop <= gridHeight;

  const columns = `3.5rem repeat(${dayCount}, minmax(0, 1fr))`;
  // Sticky header rows scroll with the grid, so the visible window grows
  // by their height to still show exactly hourStart–hourEnd.
  const headerHeight = 25 + (hasAllDay ? 24 : 0);

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-[13px] leading-[18px]">
      {/* Header lives inside the scroll container (sticky) so it shares
          the scrollbar's width reduction and stays aligned with the day
          columns below. */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: (config.hourEnd - config.hourStart) * HOUR_PX + 12 + headerHeight }}>
        {/* Day header — only today's column is marked, as "Today" on the
            accent colour, matching the timetable this view mirrors. */}
        <div className="sticky top-0 z-30 bg-card">
        <div className="grid border-b border-foreground/20" style={{ gridTemplateColumns: columns }}>
          <div />
          {days.map((day, i) => (
            <div
              key={dateKey(day)}
              className={cn(
                "border-l border-foreground/20 py-1 text-center text-xs",
                i === todayIndex ? "font-semibold text-white" : "text-muted-foreground"
              )}
              style={i === todayIndex ? { backgroundColor: TODAY_ACCENT } : undefined}
            >
              {i === todayIndex ? "Today" : DAY_LABELS[(day.getDay() + 6) % 7]}
            </div>
          ))}
        </div>

        {hasAllDay && (
          <div className="grid border-b border-foreground/20" style={{ gridTemplateColumns: columns }}>
            <div className="self-center pr-1.5 text-right text-[10px] text-muted-foreground">all-day</div>
            {days.map((day, i) => (
              <div
                key={dateKey(day)}
                className={cn("min-w-0 space-y-0.5 border-l border-foreground/20 p-0.5", i === todayIndex && "bg-foreground/[0.04]")}
              >
                {(allDayByDay.get(dateKey(day)) ?? []).map(({ event, display }) => {
                  const palette = PALETTE[display.color];
                  return (
                    <FeedEventPopover
                      key={event.id}
                      event={event}
                      display={display}
                      trigger={
                        <button
                          type="button"
                          className="block w-full overflow-hidden rounded-[4px] border px-1 text-left text-xs whitespace-nowrap text-[#1f2328]"
                          style={{ backgroundColor: palette.bg, borderColor: palette.border }}
                        >
                          {display.label ? `${display.label} ` : ""}
                          <b>{display.type}</b>
                        </button>
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
        </div>
        <div className="relative grid pt-2" style={{ gridTemplateColumns: columns }}>
          {/* Hour gutter — each label sits centred on its grid line. */}
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((hour, i) => (
              <span
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
                style={{ top: i * HOUR_PX }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {days.map((day, i) => {
            const placed = timedByDay.get(dateKey(day)) ?? [];
            const boxes = new Map(
              layoutDayEvents(placed.map((p) => ({ id: p.event.id, start: p.start, end: p.end }))).map((b) => [b.id, b])
            );
            return (
              <div
                key={dateKey(day)}
                className={cn("relative border-l border-foreground/20", i === todayIndex && "bg-foreground/[0.04]")}
                style={{
                  height: gridHeight,
                  backgroundImage: `repeating-linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 20%, transparent) 0 1px, transparent 1px ${HOUR_PX}px)`,
                }}
              >
                {placed.map(({ event, display, start, end }) => {
                  const box = boxes.get(event.id);
                  if (!box) return null;
                  const palette = PALETTE[display.color];
                  const deadline = display.deadline;
                  const room = event.location ? shortLocation(event.location).text : "";
                  const startDate = new Date(event.start);
                  return (
                    <FeedEventPopover
                      key={event.id}
                      event={event}
                      display={display}
                      trigger={
                        <button
                          type="button"
                          className="absolute flex flex-col items-stretch justify-start overflow-hidden rounded-[4px] border px-1 py-px text-left whitespace-nowrap text-[#1f2328] transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
                          style={{
                            top: (start - rangeStart * 60) * (HOUR_PX / 60),
                            height: (end - start) * (HOUR_PX / 60) - 1,
                            left: `calc(${box.left}% + 2px)`,
                            width: `calc(${box.width}% - 3px)`,
                            zIndex: box.z,
                            backgroundColor: palette.bg,
                            borderColor: palette.border,
                          }}
                        >
                          <span className="flex items-center gap-0.5">
                            {deadline && <CalendarCheck className="size-3.5 shrink-0" />}
                            {display.label ?? ""}
                          </span>
                          {display.type && <span className="block font-bold">{display.type}</span>}
                          {deadline ? (
                            <span className="block">due {hhmm(startDate)}</span>
                          ) : (
                            <>
                              <span className="block h-[18px]" />
                              <span className="block">
                                {hhmm(startDate)} - {hhmm(new Date(event.end))}
                              </span>
                            </>
                          )}
                          {room && <span className="block">{room}</span>}
                        </button>
                      }
                    />
                  );
                })}
              </div>
            );
          })}

          {showNowLine && (
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 z-0 border-t-2 border-dotted"
              style={{ top: nowTop + 8, left: "3.5rem", borderColor: TODAY_ACCENT }}
            >
              <span
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card"
                style={{ left: `${(todayIndex / dayCount) * 100}%`, top: -1, borderColor: TODAY_ACCENT }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
