import type { ChapterLevel, SessionKind } from "./types";

// Turns a plan's chapters into dated study sessions — pure date arithmetic,
// no AI (a model is left to judge how much extra practice weak chapters
// need, see replan.ts, but never to count days).
//
// Rules:
// - Chapters are studied in roadmap order: a stage starts once the stage
//   before it is finished (chapters build on earlier ones). Chapters in the
//   same stage alternate day by day instead of one strictly after the other.
// - Each chapter needs its estimated study time (DEFAULT_CHAPTER_MINUTES
//   when unknown), scaled down for chapters the student has seen or knows,
//   minus time already logged on finished sessions.
// - Only the chosen weekdays are used, at most minutesPerDay per day.
// - With a deadline, the last few study days are kept for review; if the
//   work doesn't fit, every chapter is squeezed proportionally and a
//   warning says by how much.
// - Extra review (from replanning) is scheduled first, from today.

export const DEFAULT_CHAPTER_MINUTES = 180;
const MIN_SESSION_MINUTES = 15;
const REVIEW_SESSION_MINUTES = 30;
// Without a deadline, stop rather than plan years ahead.
const MAX_SCHEDULE_DAYS = 730;

const LEVEL_FACTOR: Record<ChapterLevel, number> = {
  new: 1,
  familiar: 0.6,
  known: 0.25,
};

export interface ScheduleChapter {
  id: number;
  position: number;
  stage: number;
  estimatedMinutes: number | null;
  level: ChapterLevel | null;
  complete: boolean;
  // Minutes already done on this chapter's finished sessions.
  doneMinutes: number;
  // 0–1, or null — weaker chapters get review time first.
  mastery: number | null;
}

export interface ScheduleInput {
  chapters: ScheduleChapter[];
  // YYYY-MM-DD, the first day sessions may land on.
  startDate: string;
  deadline: string | null;
  // 0 = Sunday … 6 = Saturday.
  studyDays: number[];
  minutesPerDay: number;
  // Chapter id → extra review minutes to fit in first.
  extraReview?: Map<number, number>;
}

export interface PlannedSession {
  chapterId: number;
  date: string;
  minutes: number;
  kind: SessionKind;
}

export type ScheduleWarning =
  | { type: "no_study_days" }
  | { type: "deadline_passed" }
  | { type: "not_enough_time"; neededMinutes: number; availableMinutes: number }
  | { type: "too_long" };

export interface ScheduleResult {
  sessions: PlannedSession[];
  warnings: ScheduleWarning[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function roundTo5(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

export function chapterMinutesNeeded(chapter: ScheduleChapter): number {
  if (chapter.complete) return 0;
  const base = (chapter.estimatedMinutes ?? DEFAULT_CHAPTER_MINUTES) * LEVEL_FACTOR[chapter.level ?? "new"];
  const left = base - chapter.doneMinutes;
  return left <= 0 ? 0 : roundTo5(Math.max(MIN_SESSION_MINUTES, left));
}

// The study days from startDate on — through the deadline, or up to
// MAX_SCHEDULE_DAYS calendar days without one.
function studyDates(input: ScheduleInput, deadline: string | null): string[] {
  const days = new Set(input.studyDays);
  const dates: string[] = [];
  for (let i = 0; i < MAX_SCHEDULE_DAYS; i++) {
    const date = addDays(input.startDate, i);
    if (deadline && date > deadline) break;
    if (days.has(weekday(date))) dates.push(date);
  }
  return dates;
}

interface Work {
  chapterId: number;
  remaining: number;
  kind: SessionKind;
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const warnings: ScheduleWarning[] = [];
  if (input.studyDays.length === 0) return { sessions: [], warnings: [{ type: "no_study_days" }] };

  let deadline = input.deadline;
  if (deadline && deadline < input.startDate) {
    warnings.push({ type: "deadline_passed" });
    deadline = null;
  }
  const dates = studyDates(input, deadline);
  const perDay = input.minutesPerDay;

  const ordered = [...input.chapters].sort((a, b) => a.stage - b.stage || a.position - b.position);
  const need = new Map(ordered.map((c) => [c.id, chapterMinutesNeeded(c)]));
  const extra = [...(input.extraReview ?? new Map<number, number>())].filter(
    ([id, minutes]) => minutes > 0 && need.has(id)
  );
  const totalStudy = [...need.values()].reduce((a, b) => a + b, 0) + extra.reduce((a, [, m]) => a + m, 0);

  // Review days at the end, only with a deadline and room to spare.
  let reviewDays = 0;
  if (deadline && dates.length >= 5) {
    const candidate = Math.min(3, Math.floor(dates.length * 0.1));
    if (totalStudy <= (dates.length - candidate) * perDay) reviewDays = candidate;
  }
  const studyDateList = dates.slice(0, dates.length - reviewDays);
  const capacity = studyDateList.length * perDay;

  let scale = 1;
  if (deadline && totalStudy > capacity) {
    warnings.push({ type: "not_enough_time", neededMinutes: totalStudy, availableMinutes: capacity });
    scale = capacity / totalStudy;
  }
  const scaled = (minutes: number) => (minutes <= 0 ? 0 : roundTo5(Math.max(MIN_SESSION_MINUTES, minutes * scale)));

  // Work queue: extra review first (as one group), then each stage.
  const groups: Work[][] = [];
  if (extra.length) {
    groups.push(extra.map(([chapterId, minutes]) => ({ chapterId, remaining: scaled(minutes), kind: "review" })));
  }
  const byStage = new Map<number, Work[]>();
  for (const chapter of ordered) {
    const minutes = scaled(need.get(chapter.id) ?? 0);
    if (minutes === 0) continue;
    byStage.set(chapter.stage, [...(byStage.get(chapter.stage) ?? []), { chapterId: chapter.id, remaining: minutes, kind: "study" }]);
  }
  groups.push(...[...byStage.entries()].sort(([a], [b]) => a - b).map(([, work]) => work));

  const sessions = new Map<string, PlannedSession>();
  function log(date: string, work: Work, minutes: number) {
    const key = `${date} ${work.chapterId} ${work.kind}`;
    const existing = sessions.get(key);
    if (existing) existing.minutes += minutes;
    else sessions.set(key, { chapterId: work.chapterId, date, minutes, kind: work.kind });
  }

  let groupIndex = 0;
  let dayIndex = 0;
  for (; dayIndex < studyDateList.length && groupIndex < groups.length; dayIndex++) {
    const date = studyDateList[dayIndex];
    let left = perDay;
    // Parallel chapters take turns: each day starts one further along.
    let offset = dayIndex;
    while (left > 0 && groupIndex < groups.length) {
      const open = groups[groupIndex].filter((w) => w.remaining > 0);
      if (open.length === 0) {
        groupIndex++;
        offset = 0;
        continue;
      }
      const work = open[offset % open.length];
      const minutes = Math.min(left, work.remaining);
      log(date, work, minutes);
      work.remaining -= minutes;
      left -= minutes;
      // A chapter finished mid-day hands the rest of the day to the next one.
      if (work.remaining > 0) break;
    }
  }
  const unfinished = groups.slice(groupIndex).some((g) => g.some((w) => w.remaining > 0));
  if (!deadline && unfinished) warnings.push({ type: "too_long" });

  // Review days: short sessions on the chapters least well known, round-robin.
  if (reviewDays > 0) {
    const reviewOrder = ordered
      .filter((c) => c.level !== "known")
      .sort((a, b) => (a.mastery ?? 0.5) - (b.mastery ?? 0.5) || a.stage - b.stage || a.position - b.position);
    // As many distinct chapters per day as whole review sessions fit.
    const perReviewDay = Math.min(reviewOrder.length, Math.max(1, Math.floor(perDay / REVIEW_SESSION_MINUTES)));
    const minutesEach = Math.min(REVIEW_SESSION_MINUTES, perDay);
    let next = 0;
    for (const date of dates.slice(dates.length - reviewDays)) {
      for (let i = 0; i < perReviewDay; i++) {
        const chapter = reviewOrder[next++ % reviewOrder.length];
        log(date, { chapterId: chapter.id, remaining: 0, kind: "review" }, minutesEach);
      }
    }
  }

  return {
    sessions: [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date)),
    warnings,
  };
}

// Today as YYYY-MM-DD in the server's own timezone — the app runs on the
// user's machine, so that's the user's day.
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The scheduler's input for a saved plan, as of `today` — shared by the
// server (to build sessions) and the plan page (to show the same warnings
// the server would, without storing them).
export function scheduleInputFromPlan(
  plan: {
    options: { deadline: string | null; studyDays: number[]; minutesPerDay: number };
    chapters: {
      id: number;
      position: number;
      stage: number;
      estimated_minutes: number | null;
      current_level: ChapterLevel | null;
      completed_at: string | null;
      subtopics: { done: boolean }[];
      mastery: number | null;
    }[];
    sessions: { chapter_id: number; minutes: number; done_at: string | null }[];
  },
  today: string,
  extraReview?: Map<number, number>
): ScheduleInput {
  const doneMinutes = new Map<number, number>();
  for (const s of plan.sessions) {
    if (s.done_at) doneMinutes.set(s.chapter_id, (doneMinutes.get(s.chapter_id) ?? 0) + s.minutes);
  }
  return {
    chapters: plan.chapters.map((c) => ({
      id: c.id,
      position: c.position,
      stage: c.stage,
      estimatedMinutes: c.estimated_minutes,
      level: c.current_level,
      complete: !!c.completed_at || (c.subtopics.length > 0 && c.subtopics.every((s) => s.done)),
      doneMinutes: doneMinutes.get(c.id) ?? 0,
      mastery: c.mastery,
    })),
    startDate: today,
    deadline: plan.options.deadline,
    studyDays: plan.options.studyDays,
    minutesPerDay: plan.options.minutesPerDay,
    extraReview,
  };
}

// Open sessions whose day has passed.
export function missedSessions<T extends { date: string; done_at: string | null }>(sessions: T[], today: string): T[] {
  return sessions.filter((s) => !s.done_at && s.date < today);
}
