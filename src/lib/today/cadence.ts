// How often a study plan should show up in Today (a per-plan setting, see
// StudyPlanOptions.todayCadence). Pure and client-safe; loadToday.ts supplies
// the days the learner was active in the plan's course.
//
//   auto             — the default: courses rotate, the one studied longest ago first
//   daily            — gets a chapter step every day you haven't already worked on it
//   every_other_day  — rests the day after you studied it, otherwise rotates normally
//   weekly           — at least N study days in any 7: pushed to the front while
//                      you're short of that, back to normal rotation once you're not
//   off              — paused: no chapter or practice steps from this plan in the
//                      mixed view (reviews and mistakes still come)
//
// A "study day" is a day with work on the plan itself (a finished resource, a
// ticked subtopic, a finished plan session, a chapter quiz or flashcards, a
// code exercise), in Today or not. Reviewing the course's other cards doesn't
// count: that step comes first in Today, so it would mark the plan as done
// before its chapter step.

export const TODAY_CADENCES = ["auto", "daily", "every_other_day", "weekly", "off"] as const;
export type TodayCadence = (typeof TODAY_CADENCES)[number];

export const MIN_PER_WEEK = 1;
export const MAX_PER_WEEK = 6;
export const DEFAULT_PER_WEEK = 3;

export const CADENCE_LABELS: Record<TodayCadence, string> = {
  auto: "Automatic",
  daily: "Every day",
  every_other_day: "Every other day",
  weekly: "At least some days a week",
  off: "Off",
};

export function isTodayCadence(value: unknown): value is TodayCadence {
  return typeof value === "string" && (TODAY_CADENCES as readonly string[]).includes(value);
}

export interface CadenceSetting {
  todayCadence?: TodayCadence;
  todayPerWeek?: number;
}

export interface CadenceStatus {
  // Why the plan must get a chapter step today, in a few words; null when it needn't.
  must: string | null;
  // The plan gets no chapter step today: it rests (studied yesterday, every other day) or is off.
  skip: boolean;
  // Weekly plans only: false when the plan's coding practice isn't due today.
  // Unlike `must` it ignores today's own activity, so the step doesn't vanish
  // mid-day once you've started studying. Undefined means due.
  codeDue?: boolean;
}

export const NO_CADENCE: CadenceStatus = { must: null, skip: false };

// "YYYY-MM-DD" shifted by whole days.
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function perWeekOf(setting: CadenceSetting): number {
  const n = setting.todayPerWeek;
  return Number.isInteger(n) && (n as number) >= MIN_PER_WEEK && (n as number) <= MAX_PER_WEEK ? (n as number) : DEFAULT_PER_WEEK;
}

// `activeDays` are the local days ("YYYY-MM-DD") with activity in the plan's
// course; `today` is the learner's local day.
export function cadenceStatus(setting: CadenceSetting, activeDays: ReadonlySet<string>, today: string): CadenceStatus {
  const cadence = setting.todayCadence ?? "auto";
  const studiedToday = activeDays.has(today);
  switch (cadence) {
    case "off":
      return { must: null, skip: true };
    case "daily":
      // Already worked on today: that's the day's study done.
      return studiedToday ? NO_CADENCE : { must: "your every-day plan", skip: false };
    case "every_other_day":
      return { must: null, skip: !studiedToday && activeDays.has(shiftDay(today, -1)) };
    case "weekly": {
      const target = perWeekOf(setting);
      let days = 0;
      for (let back = 0; back < 7; back++) if (activeDays.has(shiftDay(today, -back))) days++;
      // Study days in the six days before today: today still counts toward the
      // target until it ends, so coding practice is due while that's short.
      const before = days - (studiedToday ? 1 : 0);
      const codeDue = before < target;
      if (studiedToday || days >= target) return { must: null, skip: false, codeDue };
      return { must: `${days} of ${target} study days in the last week`, skip: false, codeDue };
    }
    default:
      return NO_CADENCE;
  }
}

// A short description of the setting, for the plan page.
export function describeCadence(setting: CadenceSetting): string {
  switch (setting.todayCadence ?? "auto") {
    case "daily":
      return "Every day";
    case "every_other_day":
      return "Every other day";
    case "weekly": {
      const n = perWeekOf(setting);
      return `At least ${n} day${n === 1 ? "" : "s"} a week`;
    }
    case "off":
      return "Off";
    default:
      return "Automatic";
  }
}
