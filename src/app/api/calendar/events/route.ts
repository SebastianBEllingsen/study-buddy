import { listUpcomingEvents, createEvent, describeGoogleCalendarError } from "@/lib/googleCalendar";
import { fetchAllFeedEvents } from "@/lib/calendarFeeds";
import { listCalendarFeeds } from "@/lib/models";

// A year out comfortably covers "next exam"/"next assignment" without
// fetching a whole multi-year ICS history for feeds that never expire old
// recurring series.
const FEED_LOOKAHEAD_MS = 365 * 24 * 60 * 60 * 1000;

// Lists events from now onward — the calendar page/dashboard widget only
// ever shows upcoming deliverables, never a full history browser. Merges
// the user's own Google Calendar with any read-only external feeds
// (lib/calendarFeeds.ts) into one sorted list; a Google failure and a feed
// failure are independent, so one being unavailable never hides the other.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const maxResultsParam = url.searchParams.get("maxResults");
  const maxResults = maxResultsParam ? Number(maxResultsParam) : undefined;
  // The Upcoming widget/dashboard "My calendar" view pass this so a feed
  // toggled off "On calendar" in Settings is excluded BEFORE the
  // maxResults cap below, not after — filtering client-side after an
  // already-capped fetch could leave far fewer visible events than
  // maxResults if hidden-feed events happened to fill most of the top of
  // the sorted list (e.g. a frequent lecture feed crowding out
  // less-frequent Google events). The Assignments widget/calendar tab
  // omit this, since they want every feed event regardless of that toggle.
  const excludeHiddenFeeds = url.searchParams.get("excludeHiddenFeeds") === "true";
  const now = new Date();

  const [googleResult, feeds] = await Promise.all([
    listUpcomingEvents({ timeMin: now.toISOString(), maxResults }).then(
      (events) => ({ events, error: null as string | null }),
      (err) => {
        console.error("Listing Google Calendar events failed:", err);
        return { events: [], error: describeGoogleCalendarError(err) };
      }
    ),
    listCalendarFeeds(),
  ]);

  // Disabled feeds are skipped everywhere, unlike show_on_calendar (which
  // only excludeHiddenFeeds callers honor) — a paused feed shouldn't show
  // up in the Assignments widget or /calendar tab either.
  const activeFeeds = feeds.filter((f) => f.enabled);
  const allowedFeeds = excludeHiddenFeeds ? activeFeeds.filter((f) => f.show_on_calendar) : activeFeeds;
  const feedEvents = await fetchAllFeedEvents(allowedFeeds, {
    timeMin: now,
    timeMax: new Date(now.getTime() + FEED_LOOKAHEAD_MS),
  });

  const events = [...googleResult.events, ...feedEvents]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, maxResults ?? 20);

  // Only surface the Google error when there's nothing else to show —
  // otherwise a viewer with working feeds but no Google connection would
  // see a scary error banner over an otherwise-successful events list.
  if (googleResult.error && feeds.length === 0) {
    return Response.json({ error: googleResult.error }, { status: 502 });
  }
  return Response.json({ events });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;
  const start = typeof body?.start === "string" ? body.start : "";
  const end = typeof body?.end === "string" ? body.end : "";
  const allDay = body?.allDay === true;

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
  if (!start || !end) {
    return Response.json({ error: "Start and end are required" }, { status: 400 });
  }

  try {
    const event = await createEvent({ title, description, start, end, allDay });
    return Response.json({ event }, { status: 201 });
  } catch (err) {
    console.error("Creating Google Calendar event failed:", err);
    return Response.json({ error: describeGoogleCalendarError(err) }, { status: 502 });
  }
}
