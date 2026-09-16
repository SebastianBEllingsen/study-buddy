import { reorderCourses } from "@/lib/models";
import { parseOrderedIds } from "@/lib/reorderRequest";

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const orderedIds = parseOrderedIds(body?.orderedIds);

  if (!orderedIds) {
    return Response.json({ error: "orderedIds must be an array of course ids" }, { status: 400 });
  }

  await reorderCourses(orderedIds);
  return Response.json({ ok: true });
}
