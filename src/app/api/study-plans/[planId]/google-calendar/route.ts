import { describeGoogleCalendarError } from "@/lib/googleCalendar";
import { parseId } from "@/lib/routeParams";
import { setGoogleCalendarSync } from "@/lib/studyPlan/scheduleService";
import { StudyPlanNotFoundError } from "@/lib/studyPlan/resources";
import { getStudyPlan } from "@/lib/studyPlan/store";

type Params = { params: Promise<{ planId: string }> };

async function toggle(params: Params["params"], enabled: boolean) {
  const { planId } = await params;
  const id = parseId(planId);
  if (id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  try {
    await setGoogleCalendarSync(id, enabled);
    return Response.json({ plan: await getStudyPlan(id) });
  } catch (err) {
    if (err instanceof StudyPlanNotFoundError) return Response.json({ error: err.message }, { status: 404 });
    console.error("Study plan Google Calendar sync failed:", err);
    return Response.json({ error: describeGoogleCalendarError(err) }, { status: 502 });
  }
}

// POST adds the plan's open sessions to the user's Google Calendar and keeps
// them in step on every reschedule; DELETE removes the events it added.
export async function POST(_request: Request, { params }: Params) {
  return toggle(params, true);
}

export async function DELETE(_request: Request, { params }: Params) {
  return toggle(params, false);
}
