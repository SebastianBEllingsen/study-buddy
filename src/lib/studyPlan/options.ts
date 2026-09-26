import type { ResourceDensity, StudyPlanOptions, StudyPlanPreset } from "./types";

// Parses the plan-setup options a request (or a stored options_json)
// carries. A preset picks the defaults — "roadmap" is just chapters and
// resources, "guided" switches everything on — and any field sent
// explicitly overrides its preset default. Anything missing or malformed
// falls back to the preset's value field by field.

export const PRESET_DEFAULTS: Record<StudyPlanPreset, StudyPlanOptions> = {
  roadmap: {
    preset: "roadmap",
    webResources: true,
    density: "normal",
    topicLevels: false,
    practice: false,
    schedule: false,
    deadline: null,
    studyDays: [1, 2, 3, 4, 5],
    minutesPerDay: 60,
    googleCalendar: false,
  },
  guided: {
    preset: "guided",
    webResources: true,
    density: "normal",
    topicLevels: true,
    practice: true,
    schedule: true,
    deadline: null,
    studyDays: [1, 2, 3, 4, 5],
    minutesPerDay: 60,
    googleCalendar: false,
  },
};

export const DEFAULT_STUDY_PLAN_OPTIONS: StudyPlanOptions = PRESET_DEFAULTS.roadmap;

const DENSITIES: ResourceDensity[] = ["fewer", "normal", "more"];
export const MIN_MINUTES_PER_DAY = 15;
export const MAX_MINUTES_PER_DAY = 600;

// A real calendar date in YYYY-MM-DD form.
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseStudyDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const days = [...new Set(value)].filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  return days.length > 0 ? days.sort((a, b) => a - b) : null;
}

export function parseStudyPlanOptions(value: unknown): StudyPlanOptions {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const v = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const preset: StudyPlanPreset = v.preset === "guided" ? "guided" : "roadmap";
  const d = PRESET_DEFAULTS[preset];
  const bool = (key: keyof StudyPlanOptions, fallback: boolean) =>
    typeof v[key] === "boolean" ? (v[key] as boolean) : fallback;
  return {
    preset,
    webResources: bool("webResources", d.webResources),
    density: DENSITIES.includes(v.density as ResourceDensity) ? (v.density as ResourceDensity) : d.density,
    topicLevels: bool("topicLevels", d.topicLevels),
    practice: bool("practice", d.practice),
    schedule: bool("schedule", d.schedule),
    deadline: isIsoDate(v.deadline) ? v.deadline : null,
    studyDays: parseStudyDays(v.studyDays) ?? d.studyDays,
    minutesPerDay:
      Number.isInteger(v.minutesPerDay) &&
      (v.minutesPerDay as number) >= MIN_MINUTES_PER_DAY &&
      (v.minutesPerDay as number) <= MAX_MINUTES_PER_DAY
        ? (v.minutesPerDay as number)
        : d.minutesPerDay,
    googleCalendar: bool("googleCalendar", false),
  };
}

// How many resources to ask for per chapter, and the fewest worth keeping
// before asking once more for replacements (see resources.ts).
export function resourceTarget(density: ResourceDensity): { min: number; max: number } {
  switch (density) {
    case "fewer":
      return { min: 2, max: 3 };
    case "more":
      return { min: 5, max: 7 };
    case "normal":
    default:
      return { min: 3, max: 5 };
  }
}
