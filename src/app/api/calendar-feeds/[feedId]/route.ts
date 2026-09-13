import { deleteCalendarFeed, updateCalendarFeedVisibility } from "@/lib/models";

type Params = { params: Promise<{ feedId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { feedId } = await params;
  const id = Number(feedId);
  const body = await request.json().catch(() => ({}));

  const fields: { show_on_calendar?: boolean; show_in_widget?: boolean } = {};
  if (typeof body?.show_on_calendar === "boolean") fields.show_on_calendar = body.show_on_calendar;
  if (typeof body?.show_in_widget === "boolean") fields.show_in_widget = body.show_in_widget;
  if (Object.keys(fields).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await updateCalendarFeedVisibility(id, fields);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { feedId } = await params;
  await deleteCalendarFeed(Number(feedId));
  return new Response(null, { status: 204 });
}
