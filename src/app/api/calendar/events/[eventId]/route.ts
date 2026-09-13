import { updateEvent, deleteEvent, describeGoogleCalendarError } from "@/lib/googleCalendar";

type Params = { params: Promise<{ eventId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { eventId } = await params;
  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : undefined;
  const start = typeof body?.start === "string" ? body.start : "";
  const end = typeof body?.end === "string" ? body.end : "";
  const allDay = body?.allDay === true;

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
  if (!start || !end) {
    return Response.json({ error: "Start and end are required" }, { status: 400 });
  }

  try {
    const event = await updateEvent(eventId, { title, description, start, end, allDay });
    return Response.json({ event });
  } catch (err) {
    console.error("Updating Google Calendar event failed:", err);
    return Response.json({ error: describeGoogleCalendarError(err) }, { status: 502 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { eventId } = await params;
  try {
    await deleteEvent(eventId);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("Deleting Google Calendar event failed:", err);
    return Response.json({ error: describeGoogleCalendarError(err) }, { status: 502 });
  }
}
