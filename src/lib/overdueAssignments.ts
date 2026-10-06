import type { CalendarEvent } from "./googleCalendar";

// How far back the Assignments widget looks for items whose due date has
// passed. Bounded so a feed with years of history can't flood the list with
// stale unchecked entries.
export const OVERDUE_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;

function localMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

// When an event stops being "upcoming". All-day events carry date-only
// strings (end is exclusive, but some feeds emit end == start for a
// deadline), so they run through the end of their last day in local time.
export function dueTimeMs(event: Pick<CalendarEvent, "start" | "end" | "allDay">): number {
  if (event.allDay) return Math.max(localMidnight(event.end), localMidnight(event.start) + 24 * 60 * 60 * 1000);
  return new Date(event.end).getTime();
}

export function isPastDue(event: Pick<CalendarEvent, "start" | "end" | "allDay">, now: Date): boolean {
  return dueTimeMs(event) <= now.getTime();
}

// An event whose due time has passed only stays listed while it hasn't been
// checked off; upcoming/ongoing events are always kept.
export function keepUnlessCompletedAndPast<T extends Pick<CalendarEvent, "id" | "start" | "end" | "allDay">>(
  events: T[],
  completedIds: ReadonlySet<string>,
  now: Date
): T[] {
  return events.filter((e) => !isPastDue(e, now) || !completedIds.has(e.id));
}
