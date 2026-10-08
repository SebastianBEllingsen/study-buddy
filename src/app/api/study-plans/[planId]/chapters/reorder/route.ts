import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { getStudyPlan, reorderChapters } from "@/lib/studyPlan/store";
import { rescheduleQuietly } from "@/lib/studyPlan/scheduleService";
import { parseOrderedIds } from "@/lib/studyPlan/requestParsing";

type Params = { params: Promise<{ planId: string }> };

// reorderChapters only touches rows of this plan, so ids from elsewhere in
// the list are ignored rather than moved.
export async function POST(request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  if (id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  const orderedIds = parseOrderedIds((await parseJsonObjectBody(request)).orderedIds);
  if (!orderedIds) return Response.json({ error: "orderedIds must be a list of distinct ids" }, { status: 400 });
  await reorderChapters(id, orderedIds);
  // The schedule studies chapters in roadmap order, so a new order changes it.
  if ((await getStudyPlan(id))?.options.schedule) await rescheduleQuietly(id);
  return Response.json({ ok: true });
}
