import { findChapterInPlan, findResourceInPlan } from "../studyPlan/ownership";
import { getChapter, getSession, setSessionDone, updateChapter, updateResource } from "../studyPlan/store";
import type { StepCompletion } from "./planDay";

// What a Today step's "Done" records: a resource ticked off, a subtopic
// checked, or — when the day's session is finished — the plan's session.

export type CompletionRequest = StepCompletion | { type: "session"; planId: number; sessionId: number; minutes?: number };

function isId(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0;
}

export function parseCompletion(body: Record<string, unknown>): CompletionRequest | null {
  if (!isId(body.planId)) return null;
  if (body.type === "resource" && isId(body.resourceId)) {
    return { type: "resource", planId: body.planId, resourceId: body.resourceId };
  }
  if (body.type === "subtopic" && isId(body.chapterId) && Number.isInteger(body.index) && (body.index as number) >= 0) {
    return { type: "subtopic", planId: body.planId, chapterId: body.chapterId, index: body.index as number };
  }
  if (body.type === "session" && isId(body.sessionId)) {
    return {
      type: "session",
      planId: body.planId,
      sessionId: body.sessionId,
      ...(Number.isInteger(body.minutes) ? { minutes: body.minutes as number } : {}),
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

// false when the thing named doesn't exist in that plan.
export async function completeStep(req: CompletionRequest): Promise<boolean> {
  if (req.type === "resource") {
    const resource = await findResourceInPlan(req.planId, req.resourceId);
    if (!resource) return false;
    await updateResource(resource.id, { done: true });
    return true;
  }
  if (req.type === "subtopic") {
    if (!(await findChapterInPlan(req.planId, req.chapterId))) return false;
    const chapter = await getChapter(req.chapterId);
    if (!chapter || !chapter.subtopics[req.index]) return false;
    await updateChapter(chapter.id, {
      subtopics: chapter.subtopics.map((s, i) => (i === req.index ? { ...s, done: true } : s)),
    });
    return true;
  }
  const session = await getSession(req.sessionId);
  if (!session || session.plan_id !== req.planId) return false;
  await setSessionDone(session.id, true, actualMinutes(session.minutes, req.minutes));
  return true;
}
