import * as ical from "node-ical";
import type { CalendarEvent } from "./googleCalendar";
import type { CalendarFeed } from "./models";

// Fetches, parses, and normalizes read-only external ICS calendar feeds
// (a university student portal's timetable, an LMS's assignment-due-dates
// feed, ...) into the same shape Google Calendar events already use, so
// the rest of the app (the Upcoming widget, /calendar) can merge and render
// both without knowing the difference.

// A single-process personal app has no need for anything heavier than an
// in-memory Map — this just keeps a dashboard load from re-fetching and
// re-parsing a whole semester's ICS file (which can be a few thousand
// VEVENTs once recurring lecture series are counted) on every request,
// while still picking up real changes within a reasonable window.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; parsed: ical.CalendarResponse }>();

async function getParsedFeed(url: string): Promise<ical.CalendarResponse> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.parsed;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Feed responded with ${res.status}`);
  const text = await res.text();
  const parsed = ical.sync.parseICS(text);
  cache.set(url, { fetchedAt: Date.now(), parsed });
  return parsed;
}

// ICS text values can be a plain string or a `{val, params}` object when
// the property carries parameters (e.g. LANGUAGE) — this app only ever
// wants the plain text either way.
function textValue(v: string | { val: string } | undefined | null): string {
  if (!v) return "";
  return typeof v === "string" ? v : v.val;
}

function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface FeedEvent extends CalendarEvent {
  source: string;
}

// Canvas's ICS feed points every item's URL at its own CALENDAR view
// ("<domain>/calendar?include_contexts=course_<id>&...#assignment_<id>")
// rather than the assignment page itself — both ids are right there in
// that URL, so it can be rewritten to the direct
// "<domain>/courses/<id>/assignments/<id>" link a viewer actually wants to
// land on. Left unchanged for any URL that doesn't match this exact shape
// (a non-Canvas feed, or a Canvas event type this pattern doesn't cover).
function toDirectAssignmentUrl(url: string): string {
  const match = url.match(
    /^(https?:\/\/[^/]+)\/calendar\?include_contexts=course_(\d+)(?:&[^#]*)?#assignment_(\d+)$/
  );
  if (!match) return url;
  const [, origin, courseId, assignmentId] = match;
  return `${origin}/courses/${courseId}/assignments/${assignmentId}`;
}

// One feed's events within [timeMin, timeMax], recurring series expanded
// into individual occurrences — node-ical's expandRecurringEvent handles
// RRULE expansion, EXDATE exclusions, and RECURRENCE-ID overrides (a single
// rescheduled lecture) uniformly for both recurring and plain events, so
// this doesn't need to special-case either.
export async function fetchFeedEvents(
  feed: Pick<CalendarFeed, "label" | "url">,
  range: { timeMin: Date; timeMax: Date }
): Promise<FeedEvent[]> {
  const parsed = await getParsedFeed(feed.url);
  const events: FeedEvent[] = [];

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;

    const instances = ical.expandRecurringEvent(component, {
      from: range.timeMin,
      to: range.timeMax,
    });

    for (const instance of instances) {
      events.push({
        id: `${feed.label}:${component.uid}:${instance.start.toISOString()}`,
        title: textValue(instance.summary) || "(untitled)",
        description: textValue(instance.event.description) || null,
        start: instance.isFullDay ? toDateOnly(instance.start) : instance.start.toISOString(),
        end: instance.isFullDay ? toDateOnly(instance.end) : instance.end.toISOString(),
        allDay: instance.isFullDay,
        location: textValue(instance.event.location) || null,
        // Like DESCRIPTION, a URL with parameters (Canvas emits
        // "URL;VALUE=URI:...") parses as a {val, params} object rather
        // than a plain string — textValue() already handles both shapes.
        htmlLink: textValue(instance.event.url) ? toDirectAssignmentUrl(textValue(instance.event.url)) : null,
        source: feed.label,
      });
    }
  }

  return events;
}

// Fetches every configured feed in parallel; a feed that fails to
// fetch/parse (unreachable URL, malformed ICS) is logged and dropped
// rather than failing the whole merged events response.
export async function fetchAllFeedEvents(
  feeds: Pick<CalendarFeed, "label" | "url">[],
  range: { timeMin: Date; timeMax: Date }
): Promise<FeedEvent[]> {
  const results = await Promise.allSettled(feeds.map((feed) => fetchFeedEvents(feed, range)));
  const events: FeedEvent[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      events.push(...result.value);
    } else {
      console.error(`Failed to fetch calendar feed "${feeds[i].label}":`, result.reason);
    }
  });
  return events;
}
