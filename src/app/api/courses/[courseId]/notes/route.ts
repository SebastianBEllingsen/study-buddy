import { createNote } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const folderId = Number.isInteger(body?.folderId) ? Number(body.folderId) : undefined;

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  try {
    const note = await createNote(title, id, folderId);
    return Response.json({ note }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't create note" }, { status: 409 });
  }
}
