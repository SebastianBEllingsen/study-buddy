import { reorderNotes } from "@/lib/models";
import { parseOrderedIds } from "@/lib/reorderRequest";

// Sibling of /api/courses/[courseId]/documents/reorder, same shape — notes
// are reordered within one folder at a time (see NoteList in
// courses/[courseId]/page.tsx).
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const folderId = Number(body?.folderId);
  const orderedIds = parseOrderedIds(body?.orderedIds);

  if (!Number.isInteger(folderId)) {
    return Response.json({ error: "folderId is required" }, { status: 400 });
  }
  if (!orderedIds) {
    return Response.json({ error: "orderedIds must be an array of note ids" }, { status: 400 });
  }

  await reorderNotes(folderId, orderedIds);
  return Response.json({ ok: true });
}
