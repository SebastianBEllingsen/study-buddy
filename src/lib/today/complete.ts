import { findChapterInPlan, findResourceInPlan } from "../studyPlan/ownership";
import { chapterWasComplete, rescheduleIfFinishedChanged } from "../studyPlan/scheduleService";
import { localToday } from "../studyPlan/schedule";
import {
  addDoneSession,
  addSessionMinutes,
  findChapterSession,
  getChapter,
  getSession,
  setSessionDone,
  updateChapter,
  updateResource,
} from "../studyPlan/store";
import type { StepCompletion } from "./planDay";

// What a Today step's "Done" records: a resource ticked off, a subtopic
// checked, today's share of a bigger resource, or — when the day's session
// is finished — the plan's session. `minutes` is how long the step was
// planned for; it's recorded as time studied when the day had no session.

export type CompletionRequest =
  | (StepCompletion & { minutes?: number })
  | { type: "progress"; planId: number; resourceId: number; minutes?: number }
  | { type: "session"; planId: number; sessionId: number; chapterId?: number; minutes?: number };

function isId(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0;
}

function optionalMinutes(body: Record<string, unknown>): { minutes?: number } {
  return Number.isInteger(body.minutes) && (body.minutes as number) > 0 ? { minutes: body.minutes as number } : {};
}

export function parseCompletion(body: Record<string, unknown>): CompletionRequest | null {
  if (!isId(body.planId)) return null;
  if (body.type === "resource" && isId(body.resourceId)) {
    return { type: "resource", planId: body.planId, resourceId: body.resourceId, ...optionalMinutes(body) };
  }
  if (body.type === "progress" && isId(body.resourceId)) {
    return { type: "progress", planId: body.planId, resourceId: body.resourceId, ...optionalMinutes(body) };
  }
  if (body.type === "subtopic" && isId(body.chapterId) && Number.isInteger(body.index) && (body.index as number) >= 0) {
    return { type: "subtopic", planId: body.planId, chapterId: body.chapterId, index: body.index as number, ...optionalMinutes(body) };
  }
  if (body.type === "session" && isId(body.sessionId)) {
    return {
      type: "session",
      planId: body.planId,
      sessionId: body.sessionId,
      ...(isId(body.chapterId) ? { chapterId: body.chapterId } : {}),
      ...optionalMinutes(body),
    };
  }
  return null;
}

// How long a session really took is only believed when it's plausible for
// what was planned (a tab left open for hours says nothing).
export function actualMinutes(planned: number, reported: number | undefined): number | undefined {
  if (reported === undefined || reported < 5) return undefined;
  return reported >= planned * 0.25 && reported <= planned * 2 ? reported : undefined;
}

// One step is never credited with more than this.
const MAX_STEP_MINUTES = 240;

// Study done today leaves a dated record in the plan, so the day counts for
// the plan's Today frequency and the time counts toward the chapter: a
// finished session is added when the chapter has none today, and later steps
// that day add their time to it. A session the schedule already has is left
// alone — finishing the Today session ticks it off, and ticking it now would
// make the running session drop the chapter's remaining steps as done
// elsewhere.
async function recordStudy(planId: number, chapterId: number, minutes: number | undefined): Promise<void> {
  if (!minutes) return;
  const credited = Math.min(minutes, MAX_STEP_MINUTES);
  const today = localToday();
  const existing = await findChapterSession(planId, chapterId, today);
  if (!existing) {
    await addDoneSession(planId, chapterId, today, credited);
    // A session added by Today is finished the moment it's made; a scheduled one was made earlier.
  } else if (existing.done_at && existing.done_at === existing.created_at) {
    await addSessionMinutes(existing.id, credited);
  }
}

// false when the thing named doesn't exist in that plan.
export async function completeStep(req: CompletionRequest): Promise<boolean> {
  if (req.type === "resource" || req.type === "progress") {
    const resource = await findResourceInPlan(req.planId, req.resourceId);
    if (!resource) return false;
    if (req.type === "resource") await updateResource(resource.id, { done: true });
    await recordStudy(req.planId, resource.chapter_id, req.minutes);
    return true;
  }
  if (req.type === "subtopic") {
    if (!(await findChapterInPlan(req.planId, req.chapterId))) return false;
    const chapter = await getChapter(req.chapterId);
    if (!chapter || !chapter.subtopics[req.index]) return false;
    const wasComplete = await chapterWasComplete(chapter.id);
    await updateChapter(chapter.id, {
      subtopics: chapter.subtopics.map((s, i) => (i === req.index ? { ...s, done: true } : s)),
    });
    await recordStudy(req.planId, chapter.id, req.minutes);
    await rescheduleIfFinishedChanged(req.planId, chapter.id, wasComplete);
    return true;
  }
  const session = await getSession(req.sessionId);
  if (session && session.plan_id === req.planId) {
    await setSessionDone(session.id, true, actualMinutes(session.minutes, req.minutes));
    return true;
  }
  // The session's id is gone — a reschedule (finishing a chapter, adding one)
  // replaces the plan's open sessions while a Today session is running. Its
  // chapter's session for today stands in for it.
  if (req.chapterId === undefined || !(await findChapterInPlan(req.planId, req.chapterId))) return false;
  const stand = await findChapterSession(req.planId, req.chapterId, localToday());
  if (stand) await setSessionDone(stand.id, true, actualMinutes(stand.minutes, req.minutes));
  // No session left for that chapter today (it was finished, so its sessions
  // went): nothing to tick off.
  return true;
}
