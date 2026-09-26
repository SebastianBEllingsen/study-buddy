import { createEvent, deleteEvent } from "../googleCalendar";
import { getCourse } from "../models";
import { buildSchedule, localToday, scheduleInputFromPlan, type ScheduleWarning } from "./schedule";
import { StudyPlanNotFoundError } from "./resources";
import {
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
      title: `${session.kind === "review" ? "Review" : "Study"}: ${chapter}`,
      description: `${session.minutes} minutes${course ? ` · ${course.name}` : ""} — from your study plan.`,
      start: session.date,
      end: addDay(session.date),
      allDay: true,
    });
    await setSessionGoogleEventId(session.id, event.id);
  }
}

// Rebuilds the plan's open sessions from today. Finished sessions are kept
// (and count toward their chapters). With the schedule switched off, the
// open sessions are cleared instead.
export async function reschedulePlan(
  planId: number,
  extraReview?: Map<number, number>
): Promise<{ warnings: ScheduleWarning[] }> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();
  if (plan.options.googleCalendar) await removeGoogleEvents(plan, true);

  if (!plan.options.schedule) {
    await replaceOpenSessions(planId, []);
    return { warnings: [] };
  }
  const { sessions, warnings } = buildSchedule(scheduleInputFromPlan(plan, localToday(), extraReview));
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

// For callers where the schedule is a side effect (a finished build, new
// chapters): a scheduling or Google Calendar hiccup is logged, never thrown.
export async function rescheduleQuietly(planId: number): Promise<void> {
  try {
    await reschedulePlan(planId);
  } catch (err) {
    console.error("Study plan: rescheduling failed:", err);
  }
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
