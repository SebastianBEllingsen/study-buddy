import { reorderNotes } from "@/lib/models";
import { parseOrderedIds } from "@/lib/reorderRequest";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// Sibling of /api/courses/[courseId]/documents/reorder, same shape — notes
// are reordered within one folder at a time (see NoteList in
// courses/[courseId]/page.tsx) — null explicitly means the course's own
// top-level list, not "any folder".
export async function PATCH(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const folderId = body?.folderId === null ? null : Number(body?.folderId);
  const orderedIds = parseOrderedIds(body?.orderedIds);

  if (folderId !== null && !Number.isInteger(folderId)) {
    return Response.json({ error: "folderId is required" }, { status: 400 });
  }
  if (!orderedIds) {
    return Response.json({ error: "orderedIds must be an array of note ids" }, { status: 400 });
  }

  await reorderNotes(id, folderId, orderedIds);
  return Response.json({ ok: true });
}
