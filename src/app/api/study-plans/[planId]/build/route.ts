import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { buildPlanResources } from "@/lib/studyPlan/generatePlan";
import { getStudyPlan } from "@/lib/studyPlan/store";
import { parseChapterLevels } from "@/lib/studyPlan/requestParsing";
import { canBuildPlan } from "@/lib/studyPlanDisplay";

type Params = { params: Promise<{ planId: string }> };

// Second step of building a plan: body { levels: { [chapterId]: level } }
// from the "what do you already know?" step, then resources are found for
// every chapter. Also retries a plan whose build failed or was cut off.
export async function POST(request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  const plan = id === null ? undefined : await getStudyPlan(id);
  if (!plan || id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  if (!canBuildPlan(plan)) {
    return Response.json({ error: "This plan has already been built." }, { status: 409 });
  }

  const levels = parseChapterLevels((await parseJsonObjectBody(request)).levels);
  if (!levels) return Response.json({ error: "Invalid levels" }, { status: 400 });
  const ownIds = new Set(plan.chapters.map((c) => c.id));
  for (const chapterId of levels.keys()) if (!ownIds.has(chapterId)) levels.delete(chapterId);

  try {
    return Response.json({ plan: await buildPlanResources(id, levels) });
  } catch (err) {
    if (err instanceof AiDisabledError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Study plan build failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
