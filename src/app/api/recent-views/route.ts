import { clearRecentViews, listRecentViews, recordRecentView, type RecentViewType } from "@/lib/models";

const VALID_TYPES: RecentViewType[] = ["note", "document", "item"];

export async function GET() {
  return Response.json({ views: await listRecentViews() });
}

export async function DELETE() {
  await clearRecentViews();
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const type = body?.type;
  const id = Number(body?.id);
  if (!VALID_TYPES.includes(type) || !Number.isInteger(id)) {
    return Response.json({ error: "type and id are required" }, { status: 400 });
  }

  await recordRecentView(type, id);
  return Response.json({ ok: true });
}
