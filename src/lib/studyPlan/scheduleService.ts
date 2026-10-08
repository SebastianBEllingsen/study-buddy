import { createEvent, deleteEvent } from "../googleCalendar";
import { getCourse } from "../models";
import { buildSchedule, carriedExtraReview, localToday, scheduleInputFromPlan, type ScheduleWarning } from "./schedule";
import { getExamDate } from "../readiness/load";
import { StudyPlanNotFoundError } from "./resources";
import { chapterIsComplete, sessionKindLabel } from "../studyPlanDisplay";
import {
  getChapter,
  getStudyPlan,
  replaceOpenSessions,
  setPlanOptions,
  setSessionGoogleEventId,
} from "./store";
import type { StudyPlan } from "./types";

// Saving a plan's schedule (lib/studyPlan/schedule.ts builds it) and
// mirroring it to Google Calendar when the user has asked for that.

function addDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Best effort: a session event the user already deleted in Google (404)
// or a lost connection shouldn't block rescheduling.
async function removeGoogleEvents(plan: StudyPlan, onlyOpen: boolean): Promise<void> {
  for (const session of plan.sessions) {
    if (!session.google_event_id || (onlyOpen && session.done_at)) continue;
    try {
      await deleteEvent(session.google_event_id);
    } catch (err) {
      console.warn("Study plan: couldn't remove a Google Calendar event:", err);
    }
    await setSessionGoogleEventId(session.id, null);
  }
}

export async function pushSessionsToGoogle(planId: number): Promise<void> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();
  const course = await getCourse(plan.course_id);
  const titles = new Map(plan.chapters.map((c) => [c.id, c.title]));
  for (const session of plan.sessions) {
    if (session.done_at || session.google_event_id) continue;
    const chapter = titles.get(session.chapter_id) ?? "Study";
    const event = await createEvent({
      title: `${sessionKindLabel(session.kind)}: ${chapter}`,
      description: `${session.minutes} minutes${course ? ` · ${course.name}` : ""} — from your study plan.`,
      start: session.date,
      end: addDay(session.date),
      allDay: true,
    });
    await setSessionGoogleEventId(session.id, event.id);
  }
}

async function rebuild(planId: number, extraReview?: Map<number, number>): Promise<{ warnings: ScheduleWarning[] }> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();

  if (!plan.options.schedule) {
    if (plan.options.googleCalendar) await removeGoogleEvents(plan, true);
    await replaceOpenSessions(planId, []);
    return { warnings: [] };
  }
  // Built before anything is removed, so a failure leaves the old schedule
  // and its calendar events as they were.
  const { sessions, warnings } = buildSchedule(
    scheduleInputFromPlan(plan, localToday(), extraReview ?? carriedExtraReview(plan.sessions), await getExamDate(plan.course_id))
  );
  if (plan.options.googleCalendar) await removeGoogleEvents(plan, true);
  await replaceOpenSessions(planId, sessions);
  if (plan.options.googleCalendar) {
    try {
      await pushSessionsToGoogle(planId);
    } catch (err) {
      console.error("Study plan: couldn't add sessions to Google Calendar:", err);
    }
  }
  return { warnings };
}

// One rebuild of a plan at a time: a chapter edit and a Today load can
// overlap, and two at once would each recreate the plan's calendar events.
const rebuilds = new Map<number, Promise<unknown>>();

// Rebuilds the plan's open sessions from today. Finished sessions are kept
// (and count toward their chapters). Without an explicit extraReview, the
// extra review a replan added earlier is kept too. With the schedule
// switched off, the open sessions are cleared instead.
export function reschedulePlan(
  planId: number,
  extraReview?: Map<number, number>
): Promise<{ warnings: ScheduleWarning[] }> {
  const run = (rebuilds.get(planId) ?? Promise.resolve()).catch(() => {}).then(() => rebuild(planId, extraReview));
  rebuilds.set(planId, run);
  const clear = () => {
    if (rebuilds.get(planId) === run) rebuilds.delete(planId);
  };
  run.then(clear, clear);
  return run;
}

// Whether the chapter counts as finished, read before a change that might finish it.
export async function chapterWasComplete(chapterId: number): Promise<boolean> {
  const chapter = await getChapter(chapterId);
  return !!chapter && chapterIsComplete(chapter);
}

// A chapter finished (or reopened) by ticking its subtopics changes what's
// left to schedule, like completing it outright does. Quiet: the tick that
// caused it already succeeded.
export async function rescheduleIfFinishedChanged(planId: number, chapterId: number, wasComplete: boolean): Promise<void> {
  if ((await chapterWasComplete(chapterId)) === wasComplete) return;
  if ((await getStudyPlan(planId))?.options.schedule) await rescheduleQuietly(planId);
}

// Takes a chapter's calendar events out of Google Calendar, ahead of deleting
// the chapter: its sessions go with it, and the events' ids with them, so
// afterwards nothing could remove them. Best effort, like any removal.
export async function removeChapterFromGoogle(planId: number, chapterId: number): Promise<void> {
  const plan = await getStudyPlan(planId);
  if (!plan?.options.googleCalendar) return;
  for (const session of plan.sessions) {
    if (session.chapter_id !== chapterId || !session.google_event_id) continue;
    try {
      await deleteEvent(session.google_event_id);
    } catch (err) {
      console.warn("Study plan: couldn't remove a Google Calendar event:", err);
    }
  }
}

// For callers where the schedule is a side effect (a finished build, new
// chapters): a scheduling or Google Calendar hiccup is logged, never thrown.
export async function rescheduleQuietly(planId: number): Promise<void> {
  try {
    await reschedulePlan(planId);
  } catch (err) {
    console.error("Study plan: rescheduling failed:", err);
  }
}

// Takes the plan's events out of Google Calendar, ahead of deleting the plan
// (its sessions, and so the events' ids, go with it). Best effort, like any
// removal of these events: a failure never blocks the delete.
export async function removePlanFromGoogle(planId: number): Promise<void> {
  const plan = await getStudyPlan(planId);
  if (plan?.sessions.some((s) => s.google_event_id)) await removeGoogleEvents(plan, false);
}

// Switches mirroring to Google Calendar on (adding every open session) or
// off (removing the events it added).
export async function setGoogleCalendarSync(planId: number, enabled: boolean): Promise<void> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();
  if (enabled) {
    // Flag first: if pushing fails partway, the events already created are
    // still tracked, and switching sync off (or the next reschedule)
    // cleans them up.
    await setPlanOptions(planId, { ...plan.options, googleCalendar: true });
    await pushSessionsToGoogle(planId);
  } else {
    await removeGoogleEvents(plan, false);
    await setPlanOptions(planId, { ...plan.options, googleCalendar: false });
  }
}
