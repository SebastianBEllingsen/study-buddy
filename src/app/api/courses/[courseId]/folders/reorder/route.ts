import { reorderFolders } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await request.json();
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : null;

  if (!orderedIds || !orderedIds.every((id: unknown) => Number.isInteger(id))) {
    return Response.json({ error: "orderedIds must be an array of folder ids" }, { status: 400 });
  }

  await reorderFolders(id, orderedIds);
  return Response.json({ ok: true });
}
