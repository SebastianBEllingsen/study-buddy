import { listCompletedAssignmentIds, setAssignmentCompleted } from "@/lib/models";

export async function GET() {
  return Response.json({ ids: await listCompletedAssignmentIds() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const eventId = typeof body?.eventId === "string" ? body.eventId : "";
  const completed = body?.completed === true;
  if (!eventId) return Response.json({ error: "eventId is required" }, { status: 400 });

  await setAssignmentCompleted(eventId, completed);
  return Response.json({ ok: true });
}
