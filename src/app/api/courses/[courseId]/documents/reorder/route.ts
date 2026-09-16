import { reorderDocuments } from "@/lib/models";
import { parseOrderedIds } from "@/lib/reorderRequest";

// Sibling of /api/courses/[courseId]/folders/reorder, same shape — documents
// are reordered within one folder at a time (see DocumentList in
// courses/[courseId]/page.tsx), so the folder is required, not inferred.
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const folderId = Number(body?.folderId);
  const orderedIds = parseOrderedIds(body?.orderedIds);

  if (!Number.isInteger(folderId)) {
    return Response.json({ error: "folderId is required" }, { status: 400 });
  }
  if (!orderedIds) {
    return Response.json({ error: "orderedIds must be an array of document ids" }, { status: 400 });
  }

  await reorderDocuments(folderId, orderedIds);
  return Response.json({ ok: true });
}
