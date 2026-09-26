import { parseId } from "@/lib/routeParams";
import { reschedulePlan } from "@/lib/studyPlan/scheduleService";
import { StudyPlanNotFoundError } from "@/lib/studyPlan/resources";
import { getStudyPlan } from "@/lib/studyPlan/store";

type Params = { params: Promise<{ planId: string }> };

// Rebuilds the schedule from today without asking the AI anything.
export async function POST(_request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  if (id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  try {
    const { warnings } = await reschedulePlan(id);
    return Response.json({ plan: await getStudyPlan(id), warnings });
  } catch (err) {
    if (err instanceof StudyPlanNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
