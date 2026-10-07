import { describe, expect, it } from "vitest";
import { DEFAULT_STUDY_PLAN_OPTIONS, PRESET_DEFAULTS, isIsoDate, parseStudyPlanOptions, resourceTarget } from "./options";

describe("parseStudyPlanOptions", () => {
  it("falls back to the roadmap preset for anything missing or malformed", () => {
    expect(parseStudyPlanOptions(undefined)).toEqual(DEFAULT_STUDY_PLAN_OPTIONS);
    expect(parseStudyPlanOptions("not json")).toEqual(DEFAULT_STUDY_PLAN_OPTIONS);
    expect(parseStudyPlanOptions({ webResources: "yes", density: "lots", minutesPerDay: 5 })).toEqual(
      DEFAULT_STUDY_PLAN_OPTIONS
    );
  });

  it("uses the chosen preset's defaults for fields not sent", () => {
    expect(parseStudyPlanOptions({ preset: "guided" })).toEqual(PRESET_DEFAULTS.guided);
    expect(parseStudyPlanOptions({ preset: "guided", schedule: false })).toMatchObject({
      preset: "guided",
      topicLevels: true,
      schedule: false,
    });
  });

  it("reads options stored before the newer fields existed", () => {
    expect(parseStudyPlanOptions('{"preset":"roadmap","webResources":false,"density":"more"}')).toEqual({
      ...DEFAULT_STUDY_PLAN_OPTIONS,
      webResources: false,
      density: "more",
    });
  });

  it("validates schedule details", () => {
    const parsed = parseStudyPlanOptions({ deadline: "2026-12-01", studyDays: [5, 1, 1, 9], minutesPerDay: 90 });
    expect(parsed).toMatchObject({ deadline: "2026-12-01", studyDays: [1, 5], minutesPerDay: 90 });
    expect(parseStudyPlanOptions({ deadline: "2026-02-30" }).deadline).toBeNull();
    expect(parseStudyPlanOptions({ studyDays: [] }).studyDays).toEqual([1, 2, 3, 4, 5]);
    expect(parseStudyPlanOptions({ minutesPerDay: 1000 }).minutesPerDay).toBe(60);
  });
});

describe("isIsoDate", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate(20260101)).toBe(false);
  });
});

describe("resourceTarget", () => {
  it("maps density to a per-chapter range", () => {
    expect(resourceTarget("fewer")).toEqual({ min: 2, max: 3 });
    expect(resourceTarget("normal")).toEqual({ min: 3, max: 5 });
    expect(resourceTarget("more")).toEqual({ min: 5, max: 7 });
  });

  it("keeps pre-tests off unless asked for", () => {
    expect(parseStudyPlanOptions({ preset: "guided" }).diagnostic).toBe(false);
    expect(parseStudyPlanOptions({ preset: "guided", diagnostic: true }).diagnostic).toBe(true);
  });
});

describe("Today frequency", () => {
  it("is absent by default and for 'auto', and kept for the others", () => {
    expect(parseStudyPlanOptions({})).not.toHaveProperty("todayCadence");
    expect(parseStudyPlanOptions({ todayCadence: "auto" })).not.toHaveProperty("todayCadence");
    expect(parseStudyPlanOptions({ todayCadence: "daily" })).toMatchObject({ todayCadence: "daily" });
    expect(parseStudyPlanOptions({ todayCadence: "every_other_day" })).toMatchObject({ todayCadence: "every_other_day" });
    expect(parseStudyPlanOptions({ todayCadence: "off" })).toMatchObject({ todayCadence: "off" });
  });

  it("keeps the weekly target only for 'weekly', within 1 to 6, else 3", () => {
    expect(parseStudyPlanOptions({ todayCadence: "weekly", todayPerWeek: 4 })).toMatchObject({ todayCadence: "weekly", todayPerWeek: 4 });
    expect(parseStudyPlanOptions({ todayCadence: "weekly", todayPerWeek: 9 }).todayPerWeek).toBe(3);
    expect(parseStudyPlanOptions({ todayCadence: "weekly" }).todayPerWeek).toBe(3);
    expect(parseStudyPlanOptions({ todayCadence: "daily", todayPerWeek: 4 })).not.toHaveProperty("todayPerWeek");
  });

  it("ignores anything that isn't a known setting", () => {
    expect(parseStudyPlanOptions({ todayCadence: "hourly" })).not.toHaveProperty("todayCadence");
    expect(parseStudyPlanOptions({ todayCadence: 3 })).not.toHaveProperty("todayCadence");
  });

  it("survives being stored and read back, and switching back to automatic clears it", () => {
    const stored = JSON.stringify(parseStudyPlanOptions({ todayCadence: "weekly", todayPerWeek: 2 }));
    expect(parseStudyPlanOptions(stored)).toMatchObject({ todayCadence: "weekly", todayPerWeek: 2 });
    const cleared = parseStudyPlanOptions({ ...parseStudyPlanOptions(stored), todayCadence: "auto" });
    expect(cleared).not.toHaveProperty("todayCadence");
    expect(cleared).not.toHaveProperty("todayPerWeek");
  });
});

