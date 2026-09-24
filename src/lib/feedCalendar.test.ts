import { describe, it, expect } from "vitest";
import {
  autoCourseColor,
  isDeadlineEvent,
  shortLocation,
  DEFAULT_FEED_CALENDAR_CONFIG,
  layoutDayEvents,
  parseCourseEvent,
  parseFeedCalendarConfig,
} from "./feedCalendar";

describe("parseCourseEvent", () => {
  it("splits a leading course code off the type", () => {
    expect(parseCourseEvent("IKT300 Forelesning")).toEqual({ code: "IKT300", type: "Forelesning" });
    expect(parseCourseEvent("MA-224 Lecture 2")).toEqual({ code: "MA-224", type: "Lecture 2" });
    expect(parseCourseEvent("IKT211 Lab.-undervisning")).toEqual({ code: "IKT211", type: "Lab.-undervisning" });
  });

  it("drops a group suffix and accepts a separator after the code", () => {
    expect(parseCourseEvent("FYS129-1 Øving")).toEqual({ code: "FYS129", type: "Øving" });
    expect(parseCourseEvent("MA-224: Quiz")).toEqual({ code: "MA-224", type: "Quiz" });
  });

  it("handles a bare code", () => {
    expect(parseCourseEvent("IKT213")).toEqual({ code: "IKT213", type: "" });
  });

  it("recognizes Mine Studier's trailing-code assignment titles", () => {
    expect(parseCourseEvent("Assignment - MA-224")).toEqual({ code: "MA-224", type: "Assignment" });
    expect(parseCourseEvent("Assignment - ING101")).toEqual({ code: "ING101", type: "Assignment" });
  });

  it("collapses the double space some titles have", () => {
    expect(parseCourseEvent("IKT300  Øving")).toEqual({ code: "IKT300", type: "Øving" });
  });

  it("falls back to the whole title when there is no code", () => {
    expect(parseCourseEvent("Booking")).toEqual({ code: null, type: "Booking" });
    expect(parseCourseEvent("Lunch with IKT300 group")).toEqual({ code: null, type: "Lunch with IKT300 group" });
  });
});

describe("isDeadlineEvent", () => {
  it("treats assignments and zero-length events as deadlines", () => {
    expect(isDeadlineEvent("Assignment", "2026-09-25T15:00:00Z", "2026-09-25T16:00:00Z")).toBe(true);
    expect(isDeadlineEvent("Forelesning", "2026-09-25T15:00:00Z", "2026-09-25T15:00:00Z")).toBe(true);
    expect(isDeadlineEvent("Forelesning", "2026-09-25T15:00:00Z", "2026-09-25T16:00:00Z")).toBe(false);
  });
});

describe("shortLocation", () => {
  it("shortens building names and splits off the map link", () => {
    expect(shortLocation("C-bygget Grimstad C2 041 https://link.mazemap.com/abc")).toEqual({
      text: "C C2 041",
      mapUrl: "https://link.mazemap.com/abc",
    });
  });

  it("handles multiple rooms and leaves other building names alone", () => {
    expect(shortLocation("A-bygget Grimstad A3 023, A-bygget Grimstad A3 027 https://x.y/z").text).toBe("A A3 023, A A3 027");
    expect(shortLocation("FoU-bygget F1 Aud https://x.y/z").text).toBe("FoU-bygget F1 Aud");
    expect(shortLocation("C-bygget Grimstad C4 090/91  https://x.y/z").text).toBe("C C4 090/91");
  });
});

describe("autoCourseColor", () => {
  it("is stable per code and grey for no code", () => {
    expect(autoCourseColor("IKT300")).toBe(autoCourseColor("IKT300"));
    expect(autoCourseColor(null)).toBe("grey");
    expect(autoCourseColor("IKT300")).not.toBe("grey");
  });
});

describe("parseFeedCalendarConfig", () => {
  it("returns defaults for null, garbage, and malformed JSON", () => {
    expect(parseFeedCalendarConfig(null)).toEqual(DEFAULT_FEED_CALENDAR_CONFIG);
    expect(parseFeedCalendarConfig("{not json")).toEqual(DEFAULT_FEED_CALENDAR_CONFIG);
    expect(parseFeedCalendarConfig(42)).toEqual(DEFAULT_FEED_CALENDAR_CONFIG);
  });

  it("parses a stored JSON string", () => {
    const config = parseFeedCalendarConfig(
      JSON.stringify({
        hourStart: 7,
        hourEnd: 18,
        showWeekends: false,
        defaultView: "month",
        courses: { IKT300: { color: "pink", alias: "  Nettverk  " } },
      })
    );
    expect(config).toEqual({
      hourStart: 7,
      hourEnd: 18,
      showWeekends: false,
      defaultView: "month",
      courses: { IKT300: { color: "pink", alias: "Nettverk" } },
    });
  });

  it("clamps hours and resets an inverted range", () => {
    expect(parseFeedCalendarConfig({ hourStart: -3, hourEnd: 30 })).toMatchObject({ hourStart: 0, hourEnd: 24 });
    expect(parseFeedCalendarConfig({ hourStart: 18, hourEnd: 9 })).toMatchObject({ hourStart: 8, hourEnd: 20 });
  });

  it("drops unknown colours, empty aliases, and empty course entries", () => {
    const config = parseFeedCalendarConfig({
      courses: { A: { color: "#ff0000" }, B: { alias: "   " }, C: { color: "teal", alias: "x".repeat(60) } },
    });
    expect(config.courses).toEqual({ C: { color: "teal", alias: "x".repeat(40) } });
  });
});

describe("layoutDayEvents", () => {
  const byId = (boxes: ReturnType<typeof layoutDayEvents>) => Object.fromEntries(boxes.map((b) => [b.id, b]));

  it("gives a lone event the full width", () => {
    expect(layoutDayEvents([{ id: "a", start: 60, end: 120 }])).toEqual([{ id: "a", left: 0, width: 100, z: 1 }]);
  });

  it("puts events starting close together side by side", () => {
    const boxes = byId(
      layoutDayEvents([
        { id: "booking", start: 720, end: 900 },
        { id: "lab", start: 735, end: 960 },
      ])
    );
    expect(boxes.booking).toMatchObject({ left: 0, width: 50 });
    expect(boxes.lab).toMatchObject({ left: 50, width: 50 });
  });

  it("nests a later event on top of a long running block", () => {
    const boxes = byId(
      layoutDayEvents([
        { id: "lab", start: 615, end: 960 },
        { id: "lecture", start: 675, end: 720 },
      ])
    );
    expect(boxes.lab).toMatchObject({ left: 0, width: 100, z: 1 });
    expect(boxes.lecture.left).toBeGreaterThan(0);
    expect(boxes.lecture.z).toBe(2);
  });

  it("does not treat back-to-back events as overlapping", () => {
    const boxes = byId(
      layoutDayEvents([
        { id: "morning", start: 555, end: 720 },
        { id: "noon", start: 720, end: 800 },
      ])
    );
    expect(boxes.morning).toMatchObject({ left: 0, width: 100 });
    expect(boxes.noon).toMatchObject({ left: 0, width: 100, z: 1 });
  });
});
