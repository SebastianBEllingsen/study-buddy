import { hasPassed, PASS_MASTERY } from "./mastery";
import type { ChapterLevel, SessionKind } from "./types";

// Turns a plan's chapters into dated study sessions — pure date arithmetic,
// no AI (a model is left to judge how much extra practice weak chapters
// need, see replan.ts, but never to count days).
//
// Rules:
// - Chapters are studied in roadmap order: a chapter starts once the
//   chapters it builds on are finished — so an independent chapter doesn't
//   wait for the rest of its stage. A chapter with no known prerequisites
//   waits for the whole stage before it. Chapters that can run side by side
//   alternate day by day instead of one strictly after the other.
// - Each chapter needs its estimated study time (DEFAULT_CHAPTER_MINUTES
//   when unknown), scaled down for chapters the student has seen or knows,
//   minus time already logged on finished sessions.
// - Only the chosen weekdays are used, at most minutesPerDay per day.
// - A chapter that's done being studied but not yet passed (see
//   PASS_MASTERY) gets a short "check" session first, so the next stage
//   builds on something tested. Test results also count before a chapter is
//   started: a chapter already known well needs less time.
// - Time follows the student's real pace: an unfinished chapter keeps
//   getting time in proportion to what's left of it, and the estimates of
//   unstarted chapters are scaled by how the finished ones actually went.
// - With a deadline, the last few study days are kept for review; if the
//   work doesn't fit, every chapter is squeezed proportionally and a
//   warning says by how much.
// - Extra review (from replanning) is scheduled first, from today.

export const DEFAULT_CHAPTER_MINUTES = 180;
const MIN_SESSION_MINUTES = 15;
const REVIEW_SESSION_MINUTES = 30;
// Without a deadline, stop rather than plan years ahead.
const MAX_SCHEDULE_DAYS = 730;
// Time to test a finished chapter, before moving on from it.
export const CHECK_SESSION_MINUTES = 20;
// Progress only says something about pace after this much time on a chapter.
const MIN_PROJECTION_MINUTES = 30;
const MIN_PROJECTION_PROGRESS = 0.2;
// The learned pace needs this many finished chapters, and is kept sane.
const MIN_PACE_SAMPLES = 2;
const MIN_PACE = 0.5;
const MAX_PACE = 2;

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
  // 0–1 share of the chapter's subtopics and resources done, when known.
  progress?: number | null;
  // Studied, but its test hasn't been passed yet.
  needsCheck?: boolean;
  // Ids of the chapters this one builds on.
  prerequisites?: number[];
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

// What a chapter's mastery says its level is (a quiz taken up front works as
// a diagnostic).
function measuredFactor(mastery: number): number {
  if (mastery >= 0.85) return LEVEL_FACTOR.known;
  if (mastery >= PASS_MASTERY) return LEVEL_FACTOR.familiar;
  return LEVEL_FACTOR.new;
}

// How much of its estimate a chapter needs: measured results when there are
// any (they beat a claimed level), else the level. Applied the same before
// and after the chapter is started, so starting it doesn't change the
// estimate, and learnedPace compares against the same number.
function chapterFactor(chapter: ScheduleChapter): number {
  return chapter.mastery === null ? LEVEL_FACTOR[chapter.level ?? "new"] : measuredFactor(chapter.mastery);
}

// `pace`: how long this student takes compared to the estimates (1 = as
// estimated), see learnedPace.
export function chapterMinutesNeeded(chapter: ScheduleChapter, pace = 1): number {
  if (chapter.complete) return chapter.needsCheck ? CHECK_SESSION_MINUTES : 0;
  const base = (chapter.estimatedMinutes ?? DEFAULT_CHAPTER_MINUTES) * chapterFactor(chapter) * pace;
  let left = base - chapter.doneMinutes;
  const progress = chapter.progress ?? null;
  if (progress !== null && progress > 0 && progress < 1) {
    // Far enough in to project from the pace so far, else at least the
    // unfinished share of the estimate.
    if (chapter.doneMinutes >= MIN_PROJECTION_MINUTES && progress >= MIN_PROJECTION_PROGRESS) {
      left = chapter.doneMinutes / progress - chapter.doneMinutes;
    } else {
      left = Math.max(left, base * (1 - progress));
    }
  }
  // Not finished means not out of time: never round a chapter with work
  // left down to nothing.
  if (left <= 0 && progress !== null && progress < 1) left = MIN_SESSION_MINUTES;
  return left <= 0 ? 0 : roundTo5(Math.max(MIN_SESSION_MINUTES, left));
}

// How long the student really takes compared to the estimates: the median,
// over finished chapters, of the time logged on them against what was
// estimated. 1 until there are enough finished chapters to say.
export function learnedPace(chapters: ScheduleChapter[]): number {
  const ratios = chapters
    .filter((c) => c.complete && c.doneMinutes > 0)
    .map((c) => c.doneMinutes / ((c.estimatedMinutes ?? DEFAULT_CHAPTER_MINUTES) * chapterFactor(c)))
    .sort((a, b) => a - b);
  if (ratios.length < MIN_PACE_SAMPLES) return 1;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.min(MAX_PACE, Math.max(MIN_PACE, median));
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
  // Chapters that must be finished before this one starts.
  waitsFor: number[];
}

// A chapter waits for the chapters it builds on. With none known (a chapter
// added by hand), it waits for every chapter of an earlier stage instead.
function waitsFor(chapter: ScheduleChapter, all: ScheduleChapter[]): number[] {
  const known = new Set(all.map((c) => c.id));
  const prerequisites = (chapter.prerequisites ?? []).filter((id) => known.has(id) && id !== chapter.id);
  if (prerequisites.length > 0) return prerequisites;
  return all.filter((c) => c.stage < chapter.stage).map((c) => c.id);
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
  const pace = learnedPace(ordered);
  const need = new Map(ordered.map((c) => [c.id, chapterMinutesNeeded(c, pace)]));
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

  // Work queue: extra review first, then each chapter once what it builds
  // on is done.
  const extraWork: Work[] = extra.map(([chapterId, minutes]) => ({
    chapterId,
    remaining: scaled(minutes),
    kind: "review",
    waitsFor: [],
  }));
  const studyWork: Work[] = [];
  for (const chapter of ordered) {
    const minutes = scaled(need.get(chapter.id) ?? 0);
    if (minutes === 0) continue;
    studyWork.push({
      chapterId: chapter.id,
      remaining: minutes,
      kind: chapter.complete ? "check" : "study",
      waitsFor: chapter.complete ? [] : waitsFor(chapter, ordered),
    });
  }
  const works = [...extraWork, ...studyWork];
  const studyOf = new Map(studyWork.map((w) => [w.chapterId, w]));
  const finished = (chapterId: number) => (studyOf.get(chapterId)?.remaining ?? 0) <= 0;

  const sessions = new Map<string, PlannedSession>();
  function log(date: string, work: Work, minutes: number) {
    const key = `${date} ${work.chapterId} ${work.kind}`;
    const existing = sessions.get(key);
    if (existing) existing.minutes += minutes;
    else sessions.set(key, { chapterId: work.chapterId, date, minutes, kind: work.kind });
  }

  // What can be worked on right now: extra review before anything else,
  // then the chapters whose prerequisites are finished.
  function ready(): Work[] {
    const extraOpen = extraWork.filter((w) => w.remaining > 0);
    if (extraOpen.length > 0) return extraOpen;
    return studyWork.filter((w) => w.remaining > 0 && w.waitsFor.every(finished));
  }

  for (let dayIndex = 0; dayIndex < studyDateList.length && works.some((w) => w.remaining > 0); dayIndex++) {
    const date = studyDateList[dayIndex];
    let left = perDay;
    // Parallel chapters take turns: each day starts one further along.
    let offset = dayIndex;
    let seen = new Set<Work>();
    while (left > 0) {
      const open = ready();
      if (open.length === 0) break;
      // Chapters that just became available start the rotation afresh.
      if (open.some((w) => !seen.has(w))) offset = seen.size === 0 ? offset : 0;
      seen = new Set(open);
      const work = open[offset % open.length];
      const minutes = Math.min(left, work.remaining);
      log(date, work, minutes);
      work.remaining -= minutes;
      left -= minutes;
      // A chapter finished mid-day hands the rest of the day to the next one.
      if (work.remaining > 0) break;
    }
  }
  const unfinished = works.some((w) => w.remaining > 0);
  if (!deadline && unfinished) warnings.push({ type: "too_long" });

  // Review days: short sessions on the chapters least well known, round-robin
  // (chapters the student said they know included — this is their revision).
  if (reviewDays > 0) {
    const reviewOrder = [...ordered].sort((a, b) => (a.mastery ?? 0.5) - (b.mastery ?? 0.5) || a.stage - b.stage || a.position - b.position);
    // As many distinct chapters per day as whole review sessions fit.
    const perReviewDay = Math.min(reviewOrder.length, Math.max(1, Math.floor(perDay / REVIEW_SESSION_MINUTES)));
    const minutesEach = Math.min(REVIEW_SESSION_MINUTES, perDay);
    let next = 0;
    for (const date of dates.slice(dates.length - reviewDays)) {
      for (let i = 0; i < perReviewDay; i++) {
        const chapter = reviewOrder[next++ % reviewOrder.length];
        log(date, { chapterId: chapter.id, remaining: 0, kind: "review", waitsFor: [] }, minutesEach);
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
    options: { deadline: string | null; studyDays: number[]; minutesPerDay: number; practice?: boolean };
    chapters: {
      id: number;
      position: number;
      stage: number;
      estimated_minutes: number | null;
      current_level: ChapterLevel | null;
      completed_at: string | null;
      subtopics: { done: boolean }[];
      resources?: { done_at: string | null }[];
      prerequisite_ids?: number[];
      items?: { mode: string; best_score: number | null }[];
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
    chapters: plan.chapters.map((c) => {
      const resources = c.resources ?? [];
      const total = c.subtopics.length + resources.length;
      const done = c.subtopics.filter((s) => s.done).length + resources.filter((r) => r.done_at).length;
      // A chapter the student said they know has nothing left to study.
      const known = c.current_level === "known";
      const complete = !!c.completed_at || known || (c.subtopics.length > 0 && c.subtopics.every((s) => s.done));
      return {
        id: c.id,
        position: c.position,
        stage: c.stage,
        estimatedMinutes: c.estimated_minutes,
        level: c.current_level,
        complete,
        doneMinutes: doneMinutes.get(c.id) ?? 0,
        mastery: c.mastery,
        progress: total > 0 ? done / total : null,
        prerequisites: c.prerequisite_ids,
        // Ticking a chapter complete by hand skips its test.
        needsCheck:
          !!plan.options.practice &&
          complete &&
          !known &&
          !c.completed_at &&
          !hasPassed(
            c.mastery,
            (c.items ?? []).filter((i) => i.mode === "quiz").map((i) => i.best_score)
          ),
      };
    }),
    startDate: today,
    deadline: plan.options.deadline,
    studyDays: plan.options.studyDays,
    minutesPerDay: plan.options.minutesPerDay,
    extraReview,
  };
}

// The extra review a replan put in a plan's open sessions, as chapter id →
// minutes, so a later reschedule can keep it. Extra review is scheduled
// before any study or check, so it's the open review sessions dated before
// the first of those; review sessions after that are the deadline's final
// review days, which a reschedule rebuilds on its own.
export function carriedExtraReview(
  sessions: { chapter_id: number; date: string; minutes: number; kind: SessionKind; done_at: string | null }[]
): Map<number, number> {
  const open = sessions.filter((s) => !s.done_at);
  const firstStudy = open.filter((s) => s.kind !== "review").map((s) => s.date).sort()[0];
  const extra = new Map<number, number>();
  if (!firstStudy) return extra;
  for (const s of open) {
    if (s.kind === "review" && s.date < firstStudy) extra.set(s.chapter_id, (extra.get(s.chapter_id) ?? 0) + s.minutes);
  }
  return extra;
}

// Open sessions whose day has passed.
export function missedSessions<T extends { date: string; done_at: string | null }>(sessions: T[], today: string): T[] {
  return sessions.filter((s) => !s.done_at && s.date < today);
}
