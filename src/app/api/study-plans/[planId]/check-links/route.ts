import { parseId } from "@/lib/routeParams";
import { checkPlanLinks, StudyPlanNotFoundError } from "@/lib/studyPlan/resources";
import { getStudyPlan } from "@/lib/studyPlan/store";

type Params = { params: Promise<{ planId: string }> };

// Re-verifies every link in the plan. Called from the plan page's "Check
// links" button, and automatically when the page opens on a plan whose
// links haven't been checked in LINK_RECHECK_DAYS.
export async function POST(_request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  if (id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  try {
    await checkPlanLinks(id);
  } catch (err) {
    if (err instanceof StudyPlanNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
  return Response.json({ plan: await getStudyPlan(id) });
}
