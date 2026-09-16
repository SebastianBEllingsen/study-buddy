import { reorderGeneratedItems } from "@/lib/models";
import { parseOrderedIds } from "@/lib/reorderRequest";

// Sibling of ../documents/reorder — generated items are reordered within
// one folder at a time (see GeneratedItemList in courses/[courseId]/page.tsx).
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const folderId = Number(body?.folderId);
  const orderedIds = parseOrderedIds(body?.orderedIds);

  if (!Number.isInteger(folderId)) {
    return Response.json({ error: "folderId is required" }, { status: 400 });
  }
  if (!orderedIds) {
    return Response.json(
      { error: "orderedIds must be an array of generated item ids" },
      { status: 400 }
    );
  }

  await reorderGeneratedItems(folderId, orderedIds);
  return Response.json({ ok: true });
}
