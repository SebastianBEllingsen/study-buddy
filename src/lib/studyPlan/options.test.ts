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
});
