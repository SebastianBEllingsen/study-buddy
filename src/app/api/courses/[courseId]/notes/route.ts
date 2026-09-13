import { createNote } from "@/lib/models";

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = Number(courseId);
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
