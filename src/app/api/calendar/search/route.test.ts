import { describe, it, expect, vi, beforeEach } from "vitest";

const listUpcomingEvents = vi.fn();
const fetchAllFeedEvents = vi.fn();
const listCalendarFeeds = vi.fn();

vi.mock("@/lib/googleCalendar", () => ({
  listUpcomingEvents: (...args: unknown[]) => listUpcomingEvents(...args),
}));
vi.mock("@/lib/calendarFeeds", () => ({
  fetchAllFeedEvents: (...args: unknown[]) => fetchAllFeedEvents(...args),
}));
vi.mock("@/lib/models", () => ({
  listCalendarFeeds: (...args: unknown[]) => listCalendarFeeds(...args),
}));

const { GET } = await import("./route");

const ev = (id: string, title: string, start: string, source = "Feed") => ({
  id,
  title,
  description: null,
  location: null,
  start,
  end: start,
  allDay: true,
  htmlLink: null,
  source,
});

beforeEach(() => {
  vi.clearAllMocks();
  listUpcomingEvents.mockResolvedValue([]);
  listCalendarFeeds.mockResolvedValue([
    { label: "Feed", url: "https://x/f.ics", enabled: true },
    { label: "Off", url: "https://x/o.ics", enabled: false },
  ]);
});

describe("GET /api/calendar/search", () => {
  it("returns nothing for an empty query", async () => {
    const res = await GET(new Request("http://localhost/api/calendar/search?q=%20"));
    expect((await res.json()).events).toEqual([]);
    expect(fetchAllFeedEvents).not.toHaveBeenCalled();
  });

  it("searches enabled feeds' full history, filters by text and sorts newest first", async () => {
    fetchAllFeedEvents.mockResolvedValue([
      ev("a", "Essay 1", "2020-01-01"),
      ev("b", "Quiz", "2020-02-01"),
      ev("c", "Essay 2", "2021-01-01"),
    ]);
    listUpcomingEvents.mockResolvedValue([ev("g", "Essay review", "2020-06-01", "google")]);
    const res = await GET(new Request("http://localhost/api/calendar/search?q=essay"));
    const { events } = await res.json();
    expect(events.map((e: { id: string }) => e.id)).toEqual(["c", "g", "a"]);
    const [feeds, range] = fetchAllFeedEvents.mock.calls[0];
    expect(feeds.map((f: { label: string }) => f.label)).toEqual(["Feed"]);
    expect(range.timeMin.getTime()).toBe(0);
  });

  it("still returns feed results when Google fails", async () => {
    listUpcomingEvents.mockRejectedValue(new Error("not connected"));
    fetchAllFeedEvents.mockResolvedValue([ev("a", "Essay 1", "2020-01-01")]);
    const res = await GET(new Request("http://localhost/api/calendar/search?q=essay"));
    expect((await res.json()).events).toHaveLength(1);
  });
});
