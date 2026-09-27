import { describe, it, expect } from "vitest";
import { createDateFormatter, fromUtcTimestamp, isDateFormat, normalizeDateFormat } from "./dateFormat";
import { weekdayLabels } from "@/components/calendar/shared";

const d = new Date(2026, 8, 6, 14, 5); // Sun 6 Sep 2026, 14:05 local

describe("createDateFormatter", () => {
  it("writes Norwegian dates with dots, a 24h clock and Monday weeks", () => {
    const fmt = createDateFormatter("no");
    expect(fmt.numericDate(d)).toBe("06.09.2026");
    expect(fmt.time(d)).toBe("14:05");
    expect(fmt.dateTime(d)).toBe("06.09.2026 14:05");
    expect(fmt.weekStartsOn).toBe(1);
    // Words stay English.
    expect(fmt.date(d, { weekday: "short", day: "numeric", month: "short" })).toBe("Sun 6 Sept");
  });

  it("writes the other presets", () => {
    expect(createDateFormatter("uk").numericDate(d)).toBe("06/09/2026");
    expect(createDateFormatter("iso").numericDate(d)).toBe("2026-09-06");
    const us = createDateFormatter("us");
    expect(us.numericDate(d)).toBe("9/6/2026");
    expect(us.time(d)).toMatch(/^2:05\sPM$/);
    expect(us.weekStartsOn).toBe(0);
  });
});

describe("date format settings values", () => {
  it("accepts only known formats and defaults to UK", () => {
    expect(isDateFormat("iso")).toBe(true);
    expect(isDateFormat("de")).toBe(false);
    expect(normalizeDateFormat(null)).toBe("uk");
    expect(normalizeDateFormat("us")).toBe("us");
  });
});

describe("fromUtcTimestamp", () => {
  it("reads stored timestamps as UTC, not local time", () => {
    expect(fromUtcTimestamp("2026-09-06 23:30:00").toISOString()).toBe("2026-09-06T23:30:00.000Z");
  });
});

describe("weekdayLabels", () => {
  it("rotates labels to start on Monday", () => {
    const sundayFirst = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    expect(weekdayLabels(sundayFirst, 1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayLabels(sundayFirst, 0)).toEqual(sundayFirst);
  });
});
