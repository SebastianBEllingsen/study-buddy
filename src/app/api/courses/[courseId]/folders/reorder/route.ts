import { reorderFolders } from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { parseOrderedIds } from "@/lib/reorderRequest";

type Params = { params: Promise<{ courseId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const orderedIds = parseOrderedIds(body?.orderedIds);

  if (!orderedIds) {
    return Response.json({ error: "orderedIds must be an array of folder ids" }, { status: 400 });
  }

  await reorderFolders(id, orderedIds);
  return Response.json({ ok: true });
}
