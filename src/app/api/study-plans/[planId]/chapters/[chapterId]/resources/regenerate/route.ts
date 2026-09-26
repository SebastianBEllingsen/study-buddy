import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";
import { findChapterInPlan } from "@/lib/studyPlan/ownership";
import { regenerateChapterResources, StudyPlanNotFoundError } from "@/lib/studyPlan/resources";
import { getChapter } from "@/lib/studyPlan/store";

type Params = { params: Promise<{ planId: string; chapterId: string }> };

// "Find different resources" for one chapter — AI-suggested links are
// replaced, hand-added ones kept.
export async function POST(_request: Request, { params }: Params) {
  const { planId, chapterId } = await params;
  const planIdNum = parseId(planId);
  const chapterIdNum = parseId(chapterId);
  const chapter =
    planIdNum === null || chapterIdNum === null ? null : await findChapterInPlan(planIdNum, chapterIdNum);
  if (!chapter || planIdNum === null) return Response.json({ error: "Chapter not found" }, { status: 404 });

  try {
    await regenerateChapterResources(planIdNum, chapter.id);
    return Response.json({ chapter: await getChapter(chapter.id) });
  } catch (err) {
    if (err instanceof StudyPlanNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof AiDisabledError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Study plan resource search failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
