import {
  CannotNestSubfolderError,
  deleteFolder,
  nestFolder,
  renameFolder,
  updateFolderCustomization,
} from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string; folderId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { folderId } = await params;
  const id = parseId(folderId);
  if (id === null) return Response.json({ error: "Folder not found" }, { status: 404 });
  const body = await request.json();

  if ("parentFolderId" in body && (typeof body.parentFolderId === "number" || body.parentFolderId === null)) {
    try {
      await nestFolder(id, body.parentFolderId);
    } catch (err) {
      if (err instanceof CannotNestSubfolderError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return Response.json({ ok: true });
  }

  if ("icon" in body || "color" in body) {
    const customization: { icon?: string | null; color?: string | null } = {};
    if ("icon" in body) {
      if (body.icon !== null && (typeof body.icon !== "string" || body.icon.length > 16)) {
        return Response.json({ error: "Invalid icon" }, { status: 400 });
      }
      customization.icon = body.icon;
    }
    if ("color" in body) {
      if (body.color !== null && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
        return Response.json({ error: "Invalid color" }, { status: 400 });
      }
      customization.color = body.color;
    }
    await updateFolderCustomization(id, customization);
    return Response.json({ ok: true });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Folder name is required" }, { status: 400 });
  }
  await renameFolder(id, name);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { folderId } = await params;
  const id = parseId(folderId);
  if (id === null) return Response.json({ error: "Folder not found" }, { status: 404 });
  await deleteFolder(id);
  return new Response(null, { status: 204 });
}
