import { deleteCalendarFeed, updateCalendarFeedVisibility } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ feedId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { feedId } = await params;
  const id = parseId(feedId);
  if (id === null) return Response.json({ error: "Feed not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  const fields: { show_on_calendar?: boolean; show_in_widget?: boolean; enabled?: boolean } = {};
  if (typeof body?.show_on_calendar === "boolean") fields.show_on_calendar = body.show_on_calendar;
  if (typeof body?.show_in_widget === "boolean") fields.show_in_widget = body.show_in_widget;
  if (typeof body?.enabled === "boolean") fields.enabled = body.enabled;
  if (Object.keys(fields).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await updateCalendarFeedVisibility(id, fields);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { feedId } = await params;
  const id = parseId(feedId);
  if (id === null) return Response.json({ error: "Feed not found" }, { status: 404 });
  await deleteCalendarFeed(id);
  return new Response(null, { status: 204 });
}
