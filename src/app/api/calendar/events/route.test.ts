import { describe, it, expect, vi, beforeEach } from "vitest";

const listUpcomingEvents = vi.fn();
const describeGoogleCalendarError = vi.fn().mockReturnValue("Google error");
vi.mock("@/lib/googleCalendar", () => ({
  listUpcomingEvents: (...args: unknown[]) => listUpcomingEvents(...args),
  createEvent: vi.fn(),
  describeGoogleCalendarError: (...args: unknown[]) => describeGoogleCalendarError(...args),
}));

const fetchAllFeedEvents = vi.fn();
vi.mock("@/lib/calendarFeeds", () => ({ fetchAllFeedEvents: (...args: unknown[]) => fetchAllFeedEvents(...args) }));

const listCalendarFeeds = vi.fn();
vi.mock("@/lib/models", () => ({ listCalendarFeeds: (...args: unknown[]) => listCalendarFeeds(...args) }));

const { GET } = await import("./route");

function makeEvents(n: number, startMs = Date.now()) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    title: `Event ${i}`,
    start: new Date(startMs + i * 60_000).toISOString(),
    end: new Date(startMs + i * 60_000 + 30_000).toISOString(),
    allDay: false,
  }));
}

beforeEach(() => {
  listUpcomingEvents.mockReset().mockResolvedValue([]);
  fetchAllFeedEvents.mockReset().mockResolvedValue([]);
  listCalendarFeeds.mockReset().mockResolvedValue([]);
});

describe("GET /api/calendar/events", () => {
  it("caps results at the default of 20 when no maxResults is given", async () => {
    fetchAllFeedEvents.mockResolvedValue(makeEvents(30));
    const res = await GET(new Request("http://localhost/api/calendar/events"));
    const { events } = await res.json();
    expect(events).toHaveLength(20);
  });

  it("caps results at a valid numeric maxResults", async () => {
    fetchAllFeedEvents.mockResolvedValue(makeEvents(30));
    const res = await GET(new Request("http://localhost/api/calendar/events?maxResults=5"));
    const { events } = await res.json();
    expect(events).toHaveLength(5);
  });

  // Regression coverage: Number("abc") is NaN, and `maxResults ?? 20` only
  // guards null/undefined — NaN slipped through, and Array.slice(0, NaN)
  // silently returns [], making the calendar look empty with no error.
  it("falls back to the default cap for a non-numeric maxResults instead of returning nothing", async () => {
    fetchAllFeedEvents.mockResolvedValue(makeEvents(30));
    const res = await GET(new Request("http://localhost/api/calendar/events?maxResults=abc"));
    const { events } = await res.json();
    expect(events).toHaveLength(20);
  });

  it("falls back to the default cap for a negative maxResults", async () => {
    fetchAllFeedEvents.mockResolvedValue(makeEvents(30));
    const res = await GET(new Request("http://localhost/api/calendar/events?maxResults=-5"));
    const { events } = await res.json();
    expect(events).toHaveLength(20);
  });

  it("surfaces the Google error when there are no usable feeds at all", async () => {
    listUpcomingEvents.mockRejectedValue(new Error("no token"));
    listCalendarFeeds.mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/calendar/events"));
    expect(res.status).toBe(502);
  });

  // Regression coverage: the Google-error-surfacing check used to compare
  // against the raw feed list (feeds.length), which stays nonzero even when
  // every feed is disabled/hidden — masking a real Google failure behind an
  // empty "Nothing coming up" instead of the error banner.
  it("surfaces the Google error when every configured feed is disabled", async () => {
    listUpcomingEvents.mockRejectedValue(new Error("no token"));
    listCalendarFeeds.mockResolvedValue([{ label: "A", url: "https://x/a.ics", enabled: false, show_on_calendar: true }]);
    const res = await GET(new Request("http://localhost/api/calendar/events"));
    expect(res.status).toBe(502);
  });

  it("does not surface the Google error when a working feed has events", async () => {
    listUpcomingEvents.mockRejectedValue(new Error("no token"));
    listCalendarFeeds.mockResolvedValue([{ label: "A", url: "https://x/a.ics", enabled: true, show_on_calendar: true }]);
    fetchAllFeedEvents.mockResolvedValue(makeEvents(1));
    const res = await GET(new Request("http://localhost/api/calendar/events"));
    expect(res.status).toBe(200);
  });
});
