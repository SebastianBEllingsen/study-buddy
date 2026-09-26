import { listDocumentSummariesForCourse } from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { deleteChapter, getStudyPlan, updateChapter } from "@/lib/studyPlan/store";
import { findChapterInPlan } from "@/lib/studyPlan/ownership";
import { parseChapterPatch } from "@/lib/studyPlan/requestParsing";
import { rescheduleQuietly } from "@/lib/studyPlan/scheduleService";

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
  await updateChapter(found.chapter.id, patch);
  // Finishing (or reopening) a chapter, or moving it to another stage,
  // changes what's left to schedule.
  if (patch.completed !== undefined || patch.stage !== undefined) await rescheduleIfScheduled(found.planId);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const found = await resolve(params);
  if (!found) return Response.json({ error: "Chapter not found" }, { status: 404 });
  await deleteChapter(found.chapter.id);
  await rescheduleIfScheduled(found.planId);
  return Response.json({ ok: true });
}
