import { reorderCanvases } from "@/lib/models";
import { parseOrderedIds } from "@/lib/reorderRequest";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// Sibling of /api/courses/[courseId]/notes/reorder — canvases live in one
// flat list per course (no folders), so there's no folderId here.
export async function PATCH(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const orderedIds = parseOrderedIds(body?.orderedIds);
  if (!orderedIds) {
    return Response.json({ error: "orderedIds must be an array of canvas ids" }, { status: 400 });
  }

  await reorderCanvases(id, orderedIds);
  return Response.json({ ok: true });
}
