import { parseId } from "@/lib/routeParams";
import { replanStudyPlan } from "@/lib/studyPlan/replan";
import { StudyPlanNotFoundError } from "@/lib/studyPlan/resources";
import { getStudyPlan } from "@/lib/studyPlan/store";

type Params = { params: Promise<{ planId: string }> };

// "Replan": extra review for weak chapters (AI-judged), then a fresh
// schedule from today — see lib/studyPlan/replan.ts.
export async function POST(_request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  const plan = id === null ? undefined : await getStudyPlan(id);
  if (!plan || id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  if (!plan.options.schedule) return Response.json({ error: "This plan has no schedule." }, { status: 400 });
  try {
    const result = await replanStudyPlan(id);
    return Response.json({ ...result, plan: await getStudyPlan(id) });
  } catch (err) {
    if (err instanceof StudyPlanNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
