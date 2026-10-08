import { listDocumentSummariesForCourse, listNotesForCourse } from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { deleteChapter, getStudyPlan, updateChapter } from "@/lib/studyPlan/store";
import { findChapterInPlan } from "@/lib/studyPlan/ownership";
import { parseChapterPatch } from "@/lib/studyPlan/requestParsing";
import { chapterWasComplete, removeChapterFromGoogle, rescheduleIfFinishedChanged, rescheduleQuietly } from "@/lib/studyPlan/scheduleService";

async function rescheduleIfScheduled(planId: number) {
  const plan = await getStudyPlan(planId);
  if (plan?.options.schedule) await rescheduleQuietly(planId);
}

type Params = { params: Promise<{ planId: string; chapterId: string }> };

async function resolve(params: Params["params"]) {
  const { planId, chapterId } = await params;
  const planIdNum = parseId(planId);
  const chapterIdNum = parseId(chapterId);
  if (planIdNum === null || chapterIdNum === null) return null;
  const chapter = await findChapterInPlan(planIdNum, chapterIdNum);
  return chapter ? { planId: planIdNum, chapter } : null;
}

export async function PATCH(request: Request, { params }: Params) {
  const found = await resolve(params);
  if (!found) return Response.json({ error: "Chapter not found" }, { status: 404 });
  const parsed = parseChapterPatch(await parseJsonObjectBody(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const patch = parsed.value;
  if (patch.linked_document_ids) {
    // Only documents from the plan's own course can be linked.
    const plan = await getStudyPlan(found.planId);
    const courseDocIds = new Set((await listDocumentSummariesForCourse(plan?.course_id ?? -1)).map((d) => d.id));
    patch.linked_document_ids = patch.linked_document_ids.filter((d) => courseDocIds.has(d));
  }
  if (patch.linked_note_ids) {
    const plan = await getStudyPlan(found.planId);
    const courseNoteIds = new Set((await listNotesForCourse(plan?.course_id ?? -1)).map((n) => n.id));
    patch.linked_note_ids = patch.linked_note_ids.filter((n) => courseNoteIds.has(n));
  }
  // Only a checklist edit can finish a chapter without saying so.
  const wasComplete = patch.subtopics !== undefined && (await chapterWasComplete(found.chapter.id));
  await updateChapter(found.chapter.id, patch);
  // Finishing (or reopening) a chapter, ticking its last subtopic, or moving
  // it to another stage or level changes what's left to schedule. An edit
  // that sends the stage or level back unchanged doesn't.
  const moved =
    (patch.stage !== undefined && patch.stage !== found.chapter.stage) ||
    (patch.level !== undefined && patch.level !== found.chapter.current_level) ||
    (patch.completed !== undefined && patch.completed !== !!found.chapter.completed_at);
  if (moved) await rescheduleIfScheduled(found.planId);
  else if (patch.subtopics !== undefined) await rescheduleIfFinishedChanged(found.planId, found.chapter.id, wasComplete);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const found = await resolve(params);
  if (!found) return Response.json({ error: "Chapter not found" }, { status: 404 });
  await removeChapterFromGoogle(found.planId, found.chapter.id);
  await deleteChapter(found.chapter.id);
  await rescheduleIfScheduled(found.planId);
  return Response.json({ ok: true });
}
