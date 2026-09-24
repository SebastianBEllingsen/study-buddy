import { listUpcomingEvents, createEvent, describeGoogleCalendarError } from "@/lib/googleCalendar";
import { fetchAllFeedEvents, fetchFeedEvents } from "@/lib/calendarFeeds";
import { listCalendarFeeds } from "@/lib/models";

// A year out comfortably covers "next exam"/"next assignment" without
// fetching a whole multi-year ICS history for feeds that never expire old
// recurring series.
const FEED_LOOKAHEAD_MS = 365 * 24 * 60 * 60 * 1000;

// "?timeMin=&timeMax=" as ISO strings — a feed's own week/month tab needs
// past days too (Monday of the current week, or last week), which the
// default now-onward window never includes. Anything unparseable, inverted,
// or wider than the lookahead is ignored rather than fetched.
function parseRange(url: URL): { timeMin: Date; timeMax: Date } | null {
  const min = url.searchParams.get("timeMin");
  const max = url.searchParams.get("timeMax");
  if (!min || !max) return null;
  const timeMin = new Date(min);
  const timeMax = new Date(max);
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) return null;
  if (timeMax <= timeMin || timeMax.getTime() - timeMin.getTime() > FEED_LOOKAHEAD_MS) return null;
  return { timeMin, timeMax };
}

// Lists events from now onward — the calendar page/dashboard widget only
// ever shows upcoming deliverables, never a full history browser. Merges
// the user's own Google Calendar with any read-only external feeds
// (lib/calendarFeeds.ts) into one sorted list; a Google failure and a feed
// failure are independent, so one being unavailable never hides the other.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const maxResultsParam = url.searchParams.get("maxResults");
  // A non-numeric maxResultsParam (e.g. "?maxResults=abc") used to produce
  // NaN here, which `maxResults ?? 20` below doesn't catch (?? only guards
  // null/undefined, not NaN) — Array.prototype.slice(0, NaN) then silently
  // returns an empty array instead of erroring or falling back to the
  // default, so the calendar just looked empty with no indication why.
  const maxResultsNumber = maxResultsParam ? Number(maxResultsParam) : undefined;
  const maxResults =
    maxResultsNumber !== undefined && Number.isFinite(maxResultsNumber) && maxResultsNumber >= 0
      ? maxResultsNumber
      : undefined;
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
  const range = parseRange(url);

  // "?feedId=" backs a feed's own /calendar tab: that one feed only, no
  // Google, and a fetch failure is reported rather than swallowed the way
  // the merged list swallows one bad feed among several — on a tab that
  // shows nothing else, an empty week would look like a free week.
  const feedIdParam = url.searchParams.get("feedId");
  if (feedIdParam !== null) {
    const feedId = Number(feedIdParam);
    const feed = (await listCalendarFeeds()).find((f) => f.id === feedId);
    if (!feed) return Response.json({ error: "Feed not found" }, { status: 404 });
    try {
      const events = await fetchFeedEvents(feed, range ?? { timeMin: now, timeMax: new Date(now.getTime() + FEED_LOOKAHEAD_MS) });
      events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      return Response.json({ events: events.slice(0, maxResults ?? 20) });
    } catch (err) {
      console.error(`Failed to fetch calendar feed "${feed.label}":`, err);
      const reason = err instanceof Error ? err.message : "unknown error";
      return Response.json({ error: `Couldn't load "${feed.label}": ${reason}` }, { status: 502 });
    }
  }

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
  // up in the Assignments widget or /calendar tab either. A feed with its
  // own /calendar tab is kept out of every merged view too: the point of
  // giving it a tab is keeping its events separate (it's fetched through
  // the ?feedId= branch above instead).
  const activeFeeds = feeds.filter((f) => f.enabled && !f.own_calendar);
  const allowedFeeds = excludeHiddenFeeds ? activeFeeds.filter((f) => f.show_on_calendar) : activeFeeds;
  const feedEvents = await fetchAllFeedEvents(
    allowedFeeds,
    range ?? { timeMin: now, timeMax: new Date(now.getTime() + FEED_LOOKAHEAD_MS) }
  );

  const events = [...googleResult.events, ...feedEvents]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, maxResults ?? 20);

  // Only surface the Google error when there's nothing else to show —
  // otherwise a viewer with working feeds but no Google connection would
  // see a scary error banner over an otherwise-successful events list.
  // Checked against allowedFeeds (active, and — for excludeHiddenFeeds
  // callers — not hidden from the calendar), not the raw feeds list: a
  // disabled or hidden feed still counts toward `feeds.length` but
  // contributes nothing to feedEvents, so checking the raw list could mask
  // a real Google failure behind a request that has no usable feeds either.
  if (googleResult.error && allowedFeeds.length === 0) {
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
