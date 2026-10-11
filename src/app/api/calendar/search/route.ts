import { listUpcomingEvents } from "@/lib/googleCalendar";
import { fetchAllFeedEvents } from "@/lib/calendarFeeds";
import { matchesCalendarQuery } from "@/lib/calendarSearch";
import { listCalendarFeeds } from "@/lib/models";

// A year out matches the events route's lookahead; the past side is
// unbounded for feeds (their whole history) and a few years for Google.
const LOOKAHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const GOOGLE_LOOKBACK_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 200;

// Free-text search across every calendar: Google, plus every enabled feed
// (including ones with their own tab), past and upcoming.
export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!query) return Response.json({ events: [] });

  const now = Date.now();
  const [googleEvents, feeds] = await Promise.all([
    listUpcomingEvents({
      timeMin: new Date(now - GOOGLE_LOOKBACK_MS).toISOString(),
      timeMax: new Date(now + LOOKAHEAD_MS).toISOString(),
      maxResults: 250,
      query,
    }).catch(() => []),
    listCalendarFeeds(),
  ]);
  const feedEvents = await fetchAllFeedEvents(
    feeds.filter((f) => f.enabled),
    { timeMin: new Date(0), timeMax: new Date(now + LOOKAHEAD_MS) }
  );

  const events = [...googleEvents, ...feedEvents]
    .filter((e) => matchesCalendarQuery(e, query))
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    .slice(0, MAX_RESULTS);
  return Response.json({ events });
}
