import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { InvalidAiResponseError } from "@/lib/aiResponseValidation";
import { parseId } from "@/lib/routeParams";
import { getStudyPlan } from "@/lib/studyPlan/store";
import { StudyPlanNotFoundError } from "@/lib/studyPlan/resources";
import { findNewPlanDocuments, NoNewMaterialError, supplementStudyPlan } from "@/lib/studyPlan/supplement";

type Params = { params: Promise<{ planId: string }> };

// GET: course documents added since the plan was built (what "Update plan"
// would fold in). POST: fold them in — see lib/studyPlan/supplement.ts.
export async function GET(_request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  const plan = id === null ? undefined : await getStudyPlan(id);
  if (!plan) return Response.json({ error: "Study plan not found" }, { status: 404 });
  const documents = await findNewPlanDocuments(plan);
  return Response.json({ documents: documents.map((d) => ({ id: d.id, filename: d.filename })) });
}

export async function POST(_request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  if (id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  try {
    return Response.json(await supplementStudyPlan(id));
  } catch (err) {
    if (err instanceof StudyPlanNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof NoNewMaterialError || err instanceof AiDisabledError || err instanceof InvalidAiResponseError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Study plan update failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
