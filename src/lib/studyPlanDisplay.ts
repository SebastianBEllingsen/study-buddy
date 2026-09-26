import type { LinkStatus, ResourceKind, StudyPlan, StudyPlanChapter } from "./studyPlan/types";
import { groupStages } from "./studyPlan/roadmap";
import type { ScheduleWarning } from "./studyPlan/schedule";

// Pure view logic for the study plan page and the course page's plan card —
// progress, "what's next", and badge wording — kept out of the components
// so it can be unit-tested.

// The plan page re-checks every link in the background when it opens on a
// plan whose links were last checked longer ago than this.
export const LINK_RECHECK_DAYS = 14;

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  video: "Video",
  playlist: "Playlist",
  course: "Course",
  article: "Article",
  interactive: "Interactive",
  book: "Book",
};

// ok has no badge — only links that need the user's attention get one.
export const LINK_STATUS_BADGE: Record<LinkStatus, { label: string; tone: "muted" | "warning" | "danger" } | null> = {
  ok: null,
  unchecked: { label: "Not checked", tone: "muted" },
  unknown: { label: "Couldn't verify", tone: "warning" },
  dead: { label: "Broken link", tone: "danger" },
  blocked: { label: "Not free to use", tone: "danger" },
};

export function chapterIsComplete(chapter: StudyPlanChapter): boolean {
  if (chapter.completed_at) return true;
  return chapter.subtopics.length > 0 && chapter.subtopics.every((s) => s.done);
}

export interface PlanProgress {
  chaptersDone: number;
  chaptersTotal: number;
  // Ticked subtopics plus resources marked done, over the total of both —
  // the one number the progress bar shows.
  stepsDone: number;
  stepsTotal: number;
  fraction: number;
}

export function planProgress(plan: Pick<StudyPlan, "chapters">): PlanProgress {
  let stepsDone = 0;
  let stepsTotal = 0;
  for (const chapter of plan.chapters) {
    const complete = !!chapter.completed_at;
    stepsTotal += chapter.subtopics.length + chapter.resources.length;
    stepsDone +=
      (complete ? chapter.subtopics.length : chapter.subtopics.filter((s) => s.done).length) +
      chapter.resources.filter((r) => complete || r.done_at).length;
  }
  const chaptersDone = plan.chapters.filter(chapterIsComplete).length;
  return {
    chaptersDone,
    chaptersTotal: plan.chapters.length,
    stepsDone,
    stepsTotal,
    fraction: stepsTotal === 0 ? 0 : stepsDone / stepsTotal,
  };
}

// The first unfinished chapter in roadmap order (earliest stage first).
export function nextChapter(plan: Pick<StudyPlan, "chapters">): StudyPlanChapter | null {
  for (const stage of groupStages(plan.chapters)) {
    const open = stage.find((c) => !chapterIsComplete(c));
    if (open) return open;
  }
  return null;
}

// Timestamps in this app are "YYYY-MM-DD HH:MM:SS" UTC (lib/time.ts).
function parseUtc(timestamp: string): number {
  return Date.parse(`${timestamp.replace(" ", "T")}Z`);
}

export function linksAreStale(
  plan: Pick<StudyPlan, "chapters" | "links_checked_at">,
  now: Date = new Date()
): boolean {
  if (!plan.chapters.some((c) => c.resources.length > 0)) return false;
  if (!plan.links_checked_at) return true;
  const checked = parseUtc(plan.links_checked_at);
  return Number.isNaN(checked) || now.getTime() - checked > LINK_RECHECK_DAYS * 24 * 60 * 60 * 1000;
}

// 1-based chapter numbers by overall position, as shown on the plan page.
export function chapterNumbers(chapters: Pick<StudyPlanChapter, "id" | "position">[]): Map<number, number> {
  return new Map([...chapters].sort((a, b) => a.position - b.position).map((c, i) => [c.id, i + 1]));
}

// A build that's been "generating" this long without the plan changing was
// cut off (the server restarted mid-build) — offer a retry.
const STUCK_BUILD_MS = 10 * 60 * 1000;

export function buildIsStuck(plan: Pick<StudyPlan, "status" | "updated_at">, now: Date = new Date()): boolean {
  if (plan.status !== "generating") return false;
  const updated = parseUtc(plan.updated_at);
  return Number.isNaN(updated) || now.getTime() - updated > STUCK_BUILD_MS;
}

// Whether the plan's resource step can be (re)started from the plan page.
export function canBuildPlan(plan: Pick<StudyPlan, "status" | "updated_at">, now: Date = new Date()): boolean {
  return plan.status === "draft_topics" || plan.status === "failed" || buildIsStuck(plan, now);
}

// CalendarEvent.source for study-plan sessions merged into the app's
// calendar views (api/calendar/events).
export const STUDY_PLAN_EVENT_SOURCE = "study-plan";

// --- Schedule display ---

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The Monday of the week `date` (YYYY-MM-DD) falls in.
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysIso(date, -((day + 6) % 7));
}

export interface SessionWeek<T> {
  // "this" | "next" | the week's Monday as YYYY-MM-DD.
  label: "this" | "next" | string;
  sessions: T[];
}

// Upcoming sessions in Monday-first weeks, relative to today.
export function groupSessionsByWeek<T extends { date: string }>(sessions: T[], today: string): SessionWeek<T>[] {
  const thisWeek = weekStart(today);
  const nextWeek = addDaysIso(thisWeek, 7);
  const weeks = new Map<string, T[]>();
  for (const session of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const start = weekStart(session.date);
    weeks.set(start, [...(weeks.get(start) ?? []), session]);
  }
  return [...weeks.entries()].map(([start, list]) => ({
    label: start === thisWeek ? "this" : start === nextWeek ? "next" : start,
    sessions: list,
  }));
}

export function formatDay(date: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function scheduleWarningText(warning: ScheduleWarning): string {
  switch (warning.type) {
    case "no_study_days":
      return "Pick at least one study day.";
    case "deadline_passed":
      return "The finish date has passed, so sessions carry on without one.";
    case "not_enough_time":
      return `About ${formatMinutes(Math.round((warning.neededMinutes - warning.availableMinutes) / 5) * 5)} of study doesn't fit before the finish date, so sessions are shortened. Add study days or minutes, or move the date.`;
    case "too_long":
      return "At this pace the plan runs on for more than two years — add study days or minutes.";
  }
}
