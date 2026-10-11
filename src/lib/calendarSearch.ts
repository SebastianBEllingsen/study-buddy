import type { CalendarEvent } from "./googleCalendar";

// Every whitespace-separated term has to appear (case-insensitively) in the
// event's title, description, location or source, so "essay due" finds an
// event that says "Essay 2" in the title and "due Friday" in the description.
export function matchesCalendarQuery(
  event: Pick<CalendarEvent, "title" | "description" | "location"> & { source?: string },
  query: string
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return false;
  const haystack = [event.title, event.description, event.location, event.source]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
