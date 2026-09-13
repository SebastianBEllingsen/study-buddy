import { reorderCourses } from "@/lib/models";

export async function PATCH(request: Request) {
  const body = await request.json();
  const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds : null;

  if (!orderedIds || !orderedIds.every((id: unknown) => Number.isInteger(id))) {
    return Response.json({ error: "orderedIds must be an array of course ids" }, { status: 400 });
  }

  await reorderCourses(orderedIds);
  return Response.json({ ok: true });
}
