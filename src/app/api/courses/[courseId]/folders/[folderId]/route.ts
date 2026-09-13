import {
  CannotDeleteMasterFolderError,
  CannotNestSubfolderError,
  deleteFolder,
  nestFolder,
  renameFolder,
} from "@/lib/models";

type Params = { params: Promise<{ courseId: string; folderId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { folderId } = await params;
  const body = await request.json();

  if ("parentFolderId" in body && (typeof body.parentFolderId === "number" || body.parentFolderId === null)) {
    try {
      await nestFolder(Number(folderId), body.parentFolderId);
    } catch (err) {
      if (err instanceof CannotNestSubfolderError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return Response.json({ ok: true });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Folder name is required" }, { status: 400 });
  }
  await renameFolder(Number(folderId), name);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { folderId } = await params;
  try {
    await deleteFolder(Number(folderId));
  } catch (err) {
    if (err instanceof CannotDeleteMasterFolderError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return new Response(null, { status: 204 });
}
