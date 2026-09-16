import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const safeFetch = vi.fn();
vi.mock("./urlSafety", () => ({ safeFetch: (...args: unknown[]) => safeFetch(...args) }));

const parseICS = vi.fn();
const expandRecurringEvent = vi.fn();
vi.mock("node-ical", () => ({
  sync: { parseICS: (...args: unknown[]) => parseICS(...args) },
  expandRecurringEvent: (...args: unknown[]) => expandRecurringEvent(...args),
}));

const { fetchFeedEvents, fetchAllFeedEvents } = await import("./calendarFeeds");

const range = { timeMin: new Date("2026-01-01"), timeMax: new Date("2026-02-01") };

beforeEach(() => {
  safeFetch.mockReset();
  parseICS.mockReset();
  expandRecurringEvent.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchFeedEvents", () => {
  it("fetches through safeFetch (not a raw fetch), so redirect/SSRF validation is never bypassed", async () => {
    safeFetch.mockResolvedValue({ ok: true, text: "BEGIN:VCALENDAR..." });
    parseICS.mockReturnValue({});
    await fetchFeedEvents({ label: "Timetable", url: "https://school.example/feed.ics" }, range);
    expect(safeFetch).toHaveBeenCalledWith("https://school.example/feed.ics");
    expect(parseICS).toHaveBeenCalledWith("BEGIN:VCALENDAR...");
  });

  it("propagates safeFetch's rejection reason (e.g. blocked by SSRF guard, or a redirect to a blocked address)", async () => {
    safeFetch.mockResolvedValue({ ok: false, error: "URL does not resolve to a permitted address" });
    await expect(
      fetchFeedEvents({ label: "Timetable", url: "https://evil.example/feed.ics" }, range)
    ).rejects.toThrow("URL does not resolve to a permitted address");
  });

  // Each test below uses its own distinct URL — the module-level cache in
  // calendarFeeds.ts persists for this whole file's lifetime (there's no
  // reset hook for it), so reusing a URL across tests would silently serve
  // an earlier test's cached result instead of exercising this one.

  it("caches a successfully parsed feed and doesn't re-fetch within the TTL", async () => {
    safeFetch.mockResolvedValue({ ok: true, text: "ics text" });
    parseICS.mockReturnValue({});
    await fetchFeedEvents({ label: "A", url: "https://school.example/cache-ttl.ics" }, range);
    await fetchFeedEvents({ label: "A", url: "https://school.example/cache-ttl.ics" }, range);
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches (and re-validates) once the cache entry goes stale", async () => {
    vi.useFakeTimers();
    safeFetch.mockResolvedValue({ ok: true, text: "ics text" });
    parseICS.mockReturnValue({});
    await fetchFeedEvents({ label: "A", url: "https://school.example/cache-stale.ics" }, range);
    vi.advanceTimersByTime(16 * 60 * 1000); // past the 15-minute cache TTL
    await fetchFeedEvents({ label: "A", url: "https://school.example/cache-stale.ics" }, range);
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it("expands recurring events and normalizes fields into the shared CalendarEvent shape", async () => {
    safeFetch.mockResolvedValue({ ok: true, text: "ics text" });
    parseICS.mockReturnValue({
      event1: { type: "VEVENT", uid: "u1" },
      notAnEvent: { type: "VTIMEZONE" },
    });
    expandRecurringEvent.mockReturnValue([
      {
        start: new Date("2026-01-05T10:00:00Z"),
        end: new Date("2026-01-05T11:00:00Z"),
        isFullDay: false,
        summary: "Lecture 1",
        event: { description: { val: "Intro" }, location: "Room 101", url: "https://school.example/x" },
      },
    ]);
    const events = await fetchFeedEvents({ label: "Timetable", url: "https://school.example/expand.ics" }, range);
    expect(events).toEqual([
      {
        id: "Timetable:u1:2026-01-05T10:00:00.000Z",
        title: "Lecture 1",
        description: "Intro",
        start: "2026-01-05T10:00:00.000Z",
        end: "2026-01-05T11:00:00.000Z",
        allDay: false,
        location: "Room 101",
        htmlLink: "https://school.example/x",
        source: "Timetable",
      },
    ]);
    // Non-VEVENT components (e.g. VTIMEZONE) must never reach expandRecurringEvent.
    expect(expandRecurringEvent).toHaveBeenCalledTimes(1);
  });

  it("rewrites a Canvas calendar-view event URL to the direct assignment link", async () => {
    safeFetch.mockResolvedValue({ ok: true, text: "ics text" });
    parseICS.mockReturnValue({ event1: { type: "VEVENT", uid: "u1" } });
    expandRecurringEvent.mockReturnValue([
      {
        start: new Date("2026-01-05T10:00:00Z"),
        end: new Date("2026-01-05T11:00:00Z"),
        isFullDay: false,
        summary: "Assignment due",
        event: {
          url: "https://canvas.example/calendar?include_contexts=course_42#assignment_99",
        },
      },
    ]);
    const [event] = await fetchFeedEvents({ label: "Canvas", url: "https://canvas.example/feed.ics" }, range);
    expect(event.htmlLink).toBe("https://canvas.example/courses/42/assignments/99");
  });
});

describe("fetchAllFeedEvents", () => {
  it("drops a feed that fails to fetch/parse rather than failing the whole merged result", async () => {
    safeFetch
      .mockResolvedValueOnce({ ok: true, text: "ics text" })
      .mockResolvedValueOnce({ ok: false, error: "blocked" });
    parseICS.mockReturnValue({});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const events = await fetchAllFeedEvents(
      [
        { label: "Good", url: "https://school.example/good.ics" },
        { label: "Bad", url: "https://evil.example/bad.ics" },
      ],
      range
    );

    expect(events).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"Bad"'), expect.anything());
    consoleError.mockRestore();
  });
});
