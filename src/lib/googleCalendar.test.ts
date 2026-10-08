import { describe, it, expect, vi } from "vitest";

// The module pulls in the database through models; only its pure body builder is under test.
vi.mock("./models", () => ({}));
vi.mock("googleapis", () => ({ google: {} }));

const { toGoogleEventBody } = await import("./googleCalendar");

const timed = { title: "Review", start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T10:00:00.000Z", allDay: false };
const allDay = { title: "Exam", start: "2026-03-10", end: "2026-03-11", allDay: true };

describe("toGoogleEventBody", () => {
  it("sends only the form the event has when creating", () => {
    expect(toGoogleEventBody(timed).start).toEqual({ dateTime: timed.start });
    expect(toGoogleEventBody(allDay).end).toEqual({ date: allDay.end });
  });

  it("clears the other form when patching, so an event can change between all-day and timed", () => {
    expect(toGoogleEventBody(timed, true).start).toEqual({ dateTime: timed.start, date: null });
    expect(toGoogleEventBody(allDay, true).end).toEqual({ date: allDay.end, dateTime: null });
  });
});
