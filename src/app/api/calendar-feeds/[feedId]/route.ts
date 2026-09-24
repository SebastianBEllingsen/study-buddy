import { deleteCalendarFeed, updateCalendarFeed } from "@/lib/models";
import { parseFeedCalendarConfig } from "@/lib/feedCalendar";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ feedId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { feedId } = await params;
  const id = parseId(feedId);
  if (id === null) return Response.json({ error: "Feed not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  const fields: Parameters<typeof updateCalendarFeed>[1] = {};
  if (typeof body?.show_on_calendar === "boolean") fields.show_on_calendar = body.show_on_calendar;
  if (typeof body?.show_in_widget === "boolean") fields.show_in_widget = body.show_in_widget;
  if (typeof body?.enabled === "boolean") fields.enabled = body.enabled;
  if (typeof body?.own_calendar === "boolean") fields.own_calendar = body.own_calendar;
  // Normalized through the same parser the client renders with, so what's
  // stored is always a complete, valid config — never arbitrary JSON.
  if (body?.calendar_config && typeof body.calendar_config === "object") {
    fields.calendar_config = JSON.stringify(parseFeedCalendarConfig(body.calendar_config));
  }
  if (Object.keys(fields).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await updateCalendarFeed(id, fields);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { feedId } = await params;
  const id = parseId(feedId);
  if (id === null) return Response.json({ error: "Feed not found" }, { status: 404 });
  await deleteCalendarFeed(id);
  return new Response(null, { status: 204 });
}
