import { reorderNotes } from "@/lib/models";

// Sibling of /api/courses/[courseId]/documents/reorder, same shape — notes
// are reordered within one folder at a time (see NoteList in
// courses/[courseId]/page.tsx).
export async function PATCH(request: Request) {
  const body = await request.json();
  const folderId = Number(body?.folderId);
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : null;

  if (!Number.isInteger(folderId)) {
    return Response.json({ error: "folderId is required" }, { status: 400 });
  }
  if (!orderedIds || !orderedIds.every((id: unknown) => Number.isInteger(id))) {
    return Response.json({ error: "orderedIds must be an array of note ids" }, { status: 400 });
  }

  await reorderNotes(folderId, orderedIds);
  return Response.json({ ok: true });
}
