import { getChapterRow, getResourceRow } from "./store";

// Every nested study-plan route addresses a chapter or resource through its
// plan's URL (/api/study-plans/[planId]/…). These make sure the thing named
// actually belongs to that plan — a chapter id from another plan 404s
// rather than being edited through the wrong URL.

export async function findChapterInPlan(planId: number, chapterId: number) {
  const chapter = await getChapterRow(chapterId);
  return chapter && chapter.plan_id === planId ? chapter : null;
}

export async function findResourceInPlan(planId: number, resourceId: number) {
  const resource = await getResourceRow(resourceId);
  if (!resource) return null;
  const chapter = await findChapterInPlan(planId, resource.chapter_id);
  return chapter ? resource : null;
}
