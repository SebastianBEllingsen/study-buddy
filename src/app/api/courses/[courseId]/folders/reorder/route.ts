import { reorderFolders } from "@/lib/models";

type Params = { params: Promise<{ courseId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { courseId } = await params;
  const body = await request.json();
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : null;

  if (!orderedIds || !orderedIds.every((id: unknown) => Number.isInteger(id))) {
    return Response.json({ error: "orderedIds must be an array of folder ids" }, { status: 400 });
  }

  await reorderFolders(Number(courseId), orderedIds);
  return Response.json({ ok: true });
}
