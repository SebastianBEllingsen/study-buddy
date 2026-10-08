import { describe, expect, it } from "vitest";
import { cadenceStatus, describeCadence, perWeekOf, shiftDay } from "./cadence";

const TODAY = "2026-10-07"; // a Wednesday
const days = (...d: string[]) => new Set(d);

describe("shiftDay", () => {
  it("moves by whole days across month and year ends", () => {
    expect(shiftDay("2026-10-07", -1)).toBe("2026-10-06");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("cadenceStatus", () => {
  it("does nothing for an automatic plan, or one with no setting", () => {
    expect(cadenceStatus({}, days(), TODAY)).toEqual({ must: null, skip: false });
    expect(cadenceStatus({ todayCadence: "auto" }, days(TODAY), TODAY)).toEqual({ must: null, skip: false });
  });

  describe("off", () => {
    it("always rests, whatever you did, and never forces a step", () => {
      for (const active of [days(), days(TODAY), days("2026-10-06")]) {
        expect(cadenceStatus({ todayCadence: "off" }, active, TODAY)).toEqual({ must: null, skip: true });
      }
    });
  });

  describe("every day", () => {
    it("must get a step until something has been done in the course today", () => {
      expect(cadenceStatus({ todayCadence: "daily" }, days("2026-10-06"), TODAY)).toEqual({ must: "your every-day plan", skip: false });
      expect(cadenceStatus({ todayCadence: "daily" }, days(TODAY), TODAY)).toEqual({ must: null, skip: false });
    });
  });

  describe("every other day", () => {
    it("rests the day after studying, and not otherwise", () => {
      expect(cadenceStatus({ todayCadence: "every_other_day" }, days("2026-10-06"), TODAY).skip).toBe(true);
      expect(cadenceStatus({ todayCadence: "every_other_day" }, days("2026-10-05"), TODAY).skip).toBe(false);
      expect(cadenceStatus({ todayCadence: "every_other_day" }, days(), TODAY).skip).toBe(false);
    });

    it("doesn't hide a plan you have already worked on today", () => {
      expect(cadenceStatus({ todayCadence: "every_other_day" }, days("2026-10-06", TODAY), TODAY).skip).toBe(false);
    });

    it("never forces a step: that's what the other settings are for", () => {
      expect(cadenceStatus({ todayCadence: "every_other_day" }, days(), TODAY).must).toBeNull();
    });
  });

  describe("at least N days a week", () => {
    const weekly = (n: number) => ({ todayCadence: "weekly" as const, todayPerWeek: n });

    it("must get a step while short of the target in the last 7 days, and says how far along", () => {
      expect(cadenceStatus(weekly(3), days("2026-10-05", "2026-10-02"), TODAY)).toEqual({
        must: "2 of 3 study days in the last week",
        skip: false,
        codeDue: true,
      });
      expect(cadenceStatus(weekly(3), days(), TODAY).must).toBe("0 of 3 study days in the last week");
    });

    it("keeps coding practice due all day, even after studying today", () => {
      const before = days("2026-10-05", "2026-10-02");
      expect(cadenceStatus(weekly(3), before, TODAY).codeDue).toBe(true);
      // Today's own activity is the third day: the chapter step is done, coding still due.
      const studied = cadenceStatus(weekly(3), days(TODAY, "2026-10-05", "2026-10-02"), TODAY);
      expect(studied.must).toBeNull();
      expect(studied.codeDue).toBe(true);
    });

    it("has no coding practice once the target was met before today", () => {
      expect(cadenceStatus(weekly(3), days("2026-10-06", "2026-10-05", "2026-10-04"), TODAY).codeDue).toBe(false);
    });

    it("goes back to normal once the target is met", () => {
      expect(cadenceStatus(weekly(3), days("2026-10-06", "2026-10-05", "2026-10-04"), TODAY).must).toBeNull();
    });

    it("looks at exactly the last 7 days, today included", () => {
      // 2026-10-01 is 6 days back (inside); 2026-09-30 is 7 days back (outside).
      expect(cadenceStatus(weekly(1), days("2026-10-01"), TODAY).must).toBeNull();
      expect(cadenceStatus(weekly(1), days("2026-09-30"), TODAY).must).not.toBeNull();
    });

    it("has done its day once the course has been worked on today, even if still short", () => {
      expect(cadenceStatus(weekly(5), days(TODAY), TODAY).must).toBeNull();
    });

    it("settles into the target number of days: 3 a week never asks for a fourth", () => {
      // Simulate 3 weeks of days, studying only when asked.
      const studied = new Set<string>();
      let day = "2026-10-01";
      const chosen: string[] = [];
      for (let i = 0; i < 21; i++) {
        if (cadenceStatus(weekly(3), studied, day).must) {
          studied.add(day);
          chosen.push(day);
        }
        day = shiftDay(day, 1);
      }
      // Any 7 consecutive days hold exactly 3 study days once it has settled.
      for (let i = 7; i + 7 <= chosen.length + 14; i += 7) {
        const window = chosen.filter((d) => d >= shiftDay("2026-10-01", i) && d < shiftDay("2026-10-01", i + 7));
        expect(window.length).toBe(3);
      }
    });
  });
});

describe("perWeekOf and describeCadence", () => {
  it("falls back to 3 for a missing or out-of-range target", () => {
    expect(perWeekOf({})).toBe(3);
    expect(perWeekOf({ todayPerWeek: 0 })).toBe(3);
    expect(perWeekOf({ todayPerWeek: 7 })).toBe(3);
    expect(perWeekOf({ todayPerWeek: 2.5 })).toBe(3);
    expect(perWeekOf({ todayPerWeek: 5 })).toBe(5);
  });

  it("describes each setting", () => {
    expect(describeCadence({})).toBe("Automatic");
    expect(describeCadence({ todayCadence: "daily" })).toBe("Every day");
    expect(describeCadence({ todayCadence: "every_other_day" })).toBe("Every other day");
    expect(describeCadence({ todayCadence: "off" })).toBe("Off");
    expect(describeCadence({ todayCadence: "weekly", todayPerWeek: 1 })).toBe("At least 1 day a week");
    expect(describeCadence({ todayCadence: "weekly", todayPerWeek: 4 })).toBe("At least 4 days a week");
  });
});
