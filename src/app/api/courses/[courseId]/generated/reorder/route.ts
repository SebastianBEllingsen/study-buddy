import { reorderGeneratedItems } from "@/lib/models";

// Sibling of ../documents/reorder — generated items are reordered within
// one folder at a time (see GeneratedItemList in courses/[courseId]/page.tsx).
export async function PATCH(request: Request) {
  const body = await request.json();
  const folderId = Number(body?.folderId);
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : null;

  if (!Number.isInteger(folderId)) {
    return Response.json({ error: "folderId is required" }, { status: 400 });
  }
  if (!orderedIds || !orderedIds.every((id: unknown) => Number.isInteger(id))) {
    return Response.json(
      { error: "orderedIds must be an array of generated item ids" },
      { status: 400 }
    );
  }

  await reorderGeneratedItems(folderId, orderedIds);
  return Response.json({ ok: true });
}
