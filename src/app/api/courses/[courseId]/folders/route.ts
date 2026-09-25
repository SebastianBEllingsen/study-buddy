import { createFolder, InvalidDestinationFolderError } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Folder name is required" }, { status: 400 });
  }
  const parentFolderId =
    typeof body?.parentFolderId === "number" ? body.parentFolderId : null;
  try {
    const folder = await createFolder(id, name, parentFolderId);
    return Response.json(folder, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidDestinationFolderError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
