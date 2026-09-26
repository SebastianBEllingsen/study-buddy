import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { createChapter, getStudyPlan } from "@/lib/studyPlan/store";
import { parseNewChapter } from "@/lib/studyPlan/requestParsing";
import { rescheduleQuietly } from "@/lib/studyPlan/scheduleService";

type Params = { params: Promise<{ planId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  const plan = id === null ? undefined : await getStudyPlan(id);
  if (!plan || id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  const parsed = parseNewChapter(await parseJsonObjectBody(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const chapter = await createChapter(id, parsed.value);
  if (plan.options.schedule) await rescheduleQuietly(id);
  return Response.json({ chapter }, { status: 201 });
}
