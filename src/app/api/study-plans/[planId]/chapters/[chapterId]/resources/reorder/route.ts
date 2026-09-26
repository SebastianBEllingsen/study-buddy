import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { reorderResources } from "@/lib/studyPlan/store";
import { findChapterInPlan } from "@/lib/studyPlan/ownership";
import { parseOrderedIds } from "@/lib/studyPlan/requestParsing";

type Params = { params: Promise<{ planId: string; chapterId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { planId, chapterId } = await params;
  const planIdNum = parseId(planId);
  const chapterIdNum = parseId(chapterId);
  const chapter =
    planIdNum === null || chapterIdNum === null ? null : await findChapterInPlan(planIdNum, chapterIdNum);
  if (!chapter) return Response.json({ error: "Chapter not found" }, { status: 404 });
  const orderedIds = parseOrderedIds((await parseJsonObjectBody(request)).orderedIds);
  if (!orderedIds) return Response.json({ error: "orderedIds must be a list of distinct ids" }, { status: 400 });
  await reorderResources(chapter.id, orderedIds);
  return Response.json({ ok: true });
}
