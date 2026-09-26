import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { getSession, setSessionDone } from "@/lib/studyPlan/store";

type Params = { params: Promise<{ planId: string; sessionId: string }> };

// Body: { done: boolean } — ticks a study session off (or back on).
export async function PATCH(request: Request, { params }: Params) {
  const { planId, sessionId } = await params;
  const planIdNum = parseId(planId);
  const sessionIdNum = parseId(sessionId);
  const session = sessionIdNum === null ? undefined : await getSession(sessionIdNum);
  if (!session || session.plan_id !== planIdNum) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  const body = await parseJsonObjectBody(request);
  if (typeof body.done !== "boolean") return Response.json({ error: "done must be a boolean" }, { status: 400 });
  await setSessionDone(session.id, body.done);
  return Response.json({ ok: true });
}
