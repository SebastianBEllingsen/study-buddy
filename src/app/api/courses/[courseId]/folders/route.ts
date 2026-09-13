import { createFolder, CannotNestSubfolderError } from "@/lib/models";

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const body = await request.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Folder name is required" }, { status: 400 });
  }
  const parentFolderId =
    typeof body?.parentFolderId === "number" ? body.parentFolderId : null;
  try {
    const folder = await createFolder(Number(courseId), name, parentFolderId);
    return Response.json(folder, { status: 201 });
  } catch (err) {
    if (err instanceof CannotNestSubfolderError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
