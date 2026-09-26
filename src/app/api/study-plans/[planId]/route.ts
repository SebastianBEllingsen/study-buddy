import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { deleteStudyPlan, getStudyPlan, renameStudyPlan, setPlanOptions } from "@/lib/studyPlan/store";
import { parseStudyPlanOptions } from "@/lib/studyPlan/options";
import { reschedulePlan } from "@/lib/studyPlan/scheduleService";
import type { ScheduleWarning } from "@/lib/studyPlan/schedule";

type Params = { params: Promise<{ planId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  const plan = id === null ? undefined : await getStudyPlan(id);
  if (!plan) return Response.json({ error: "Study plan not found" }, { status: 404 });
  return Response.json({ plan });
}

// Body: { title?, options? } — `options` is a partial set of plan options
// (e.g. { practice: true }), merged over the plan's current ones.
export async function PATCH(request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  const plan = id === null ? undefined : await getStudyPlan(id);
  if (!plan || id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  if ("title" in body && (typeof body.title !== "string" || !body.title.trim())) {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }
  if ("options" in body && (typeof body.options !== "object" || body.options === null || Array.isArray(body.options))) {
    return Response.json({ error: "Invalid options" }, { status: 400 });
  }
  if (typeof body.title === "string") await renameStudyPlan(id, body.title.trim().slice(0, 200));
  let warnings: ScheduleWarning[] = [];
  if (body.options) {
    // googleCalendar has its own route (it talks to Google), so it's never
    // changed here.
    const next = parseStudyPlanOptions({
      ...plan.options,
      ...(body.options as object),
      googleCalendar: plan.options.googleCalendar,
    });
    await setPlanOptions(id, next);
    const scheduleChanged = (["schedule", "deadline", "studyDays", "minutesPerDay"] as const).some(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(plan.options[key])
    );
    if (scheduleChanged) ({ warnings } = await reschedulePlan(id));
  }
  return Response.json({ plan: await getStudyPlan(id), warnings });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  if (id === null) return Response.json({ error: "Study plan not found" }, { status: 404 });
  await deleteStudyPlan(id);
  return Response.json({ ok: true });
}
