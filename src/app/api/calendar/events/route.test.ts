import { describe, it, expect, vi, beforeEach } from "vitest";

const listUpcomingEvents = vi.fn();
const describeGoogleCalendarError = vi.fn().mockReturnValue("Google error");
vi.mock("@/lib/googleCalendar", () => ({
  listUpcomingEvents: (...args: unknown[]) => listUpcomingEvents(...args),
  createEvent: vi.fn(),
  describeGoogleCalendarError: (...args: unknown[]) => describeGoogleCalendarError(...args),
}));

const fetchAllFeedEvents = vi.fn();
const fetchFeedEvents = vi.fn();
vi.mock("@/lib/calendarFeeds", () => ({
  fetchAllFeedEvents: (...args: unknown[]) => fetchAllFeedEvents(...args),
  fetchFeedEvents: (...args: unknown[]) => fetchFeedEvents(...args),
}));

const listCalendarFeeds = vi.fn();
vi.mock("@/lib/models", () => ({ listCalendarFeeds: (...args: unknown[]) => listCalendarFeeds(...args) }));

const listCalendarSessions = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({
  listCalendarSessions: (...args: unknown[]) => listCalendarSessions(...args),
}));

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
  fetchFeedEvents.mockReset().mockResolvedValue([]);
  listCalendarFeeds.mockReset().mockResolvedValue([]);
  listCalendarSessions.mockReset().mockResolvedValue([]);
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

  it("passes a valid timeMin/timeMax range through to the feeds", async () => {
    listCalendarFeeds.mockResolvedValue([{ label: "A", url: "https://x/a.ics", enabled: true, show_on_calendar: true }]);
    await GET(
      new Request("http://localhost/api/calendar/events?timeMin=2026-09-21T00:00:00.000Z&timeMax=2026-09-28T00:00:00.000Z")
    );
    expect(fetchAllFeedEvents).toHaveBeenCalledWith(expect.anything(), {
      timeMin: new Date("2026-09-21T00:00:00.000Z"),
      timeMax: new Date("2026-09-28T00:00:00.000Z"),
    });
  });

  it("ignores an inverted range and falls back to now-onward", async () => {
    await GET(
      new Request("http://localhost/api/calendar/events?timeMin=2026-09-28T00:00:00.000Z&timeMax=2026-09-21T00:00:00.000Z")
    );
    const [, range] = fetchAllFeedEvents.mock.calls[0];
    expect(Math.abs(range.timeMin.getTime() - Date.now())).toBeLessThan(5000);
  });

  describe("with feedId", () => {
    const feed = { id: 3, label: "Mine Studier", url: "https://x/ms.ics", enabled: false, show_on_calendar: false };

    it("returns only that feed's events, skipping Google, even when the feed is disabled", async () => {
      listCalendarFeeds.mockResolvedValue([feed]);
      fetchFeedEvents.mockResolvedValue(makeEvents(3));
      const res = await GET(new Request("http://localhost/api/calendar/events?feedId=3&maxResults=1000"));
      const { events } = await res.json();
      expect(events).toHaveLength(3);
      expect(listUpcomingEvents).not.toHaveBeenCalled();
      expect(fetchFeedEvents).toHaveBeenCalledWith(feed, expect.anything());
    });

    it("404s for an unknown feed", async () => {
      const res = await GET(new Request("http://localhost/api/calendar/events?feedId=99"));
      expect(res.status).toBe(404);
    });

    it("reports a feed fetch failure instead of an empty list", async () => {
      listCalendarFeeds.mockResolvedValue([feed]);
      fetchFeedEvents.mockRejectedValue(new Error("boom"));
      const res = await GET(new Request("http://localhost/api/calendar/events?feedId=3"));
      expect(res.status).toBe(502);
    });
  });

  it("leaves feeds with their own tab out of the merged list", async () => {
    listCalendarFeeds.mockResolvedValue([
      { label: "Canvas", url: "https://x/c.ics", enabled: true, show_on_calendar: true, own_calendar: false },
      { label: "Mine Studier", url: "https://x/ms.ics", enabled: true, show_on_calendar: true, own_calendar: true },
    ]);
    await GET(new Request("http://localhost/api/calendar/events"));
    const [feeds] = fetchAllFeedEvents.mock.calls[0];
    expect(feeds.map((f: { label: string }) => f.label)).toEqual(["Canvas"]);
  });
});

describe("GET /api/calendar/events study-plan sessions", () => {
  it("merges open study sessions in as all-day events", async () => {
    listCalendarSessions.mockResolvedValue([
      {
        id: 7,
        date: "2099-01-05",
        minutes: 60,
        kind: "study",
        chapter_id: 3,
        chapter_title: "Foundations",
        course_id: 1,
        course_name: "Sample Course",
      },
    ]);
    const res = await GET(new Request("http://localhost/api/calendar/events"));
    const { events } = await res.json();
    expect(events).toEqual([
      expect.objectContaining({
        id: "study-plan:7",
        title: "Study: Foundations",
        start: "2099-01-05",
        end: "2099-01-06",
        allDay: true,
        source: "study-plan",
      }),
    ]);
  });

  it("isn't part of a single feed's own tab", async () => {
    listCalendarFeeds.mockResolvedValue([{ id: 1, label: "Feed", enabled: true }]);
    await GET(new Request("http://localhost/api/calendar/events?feedId=1"));
    expect(listCalendarSessions).not.toHaveBeenCalled();
  });

  it("still returns other events when sessions can't be listed", async () => {
    listUpcomingEvents.mockResolvedValue(makeEvents(1));
    listCalendarSessions.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { events } = await (await GET(new Request("http://localhost/api/calendar/events"))).json();
    expect(events).toHaveLength(1);
  });
});
