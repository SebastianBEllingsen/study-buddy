import {
  CannotNestFolderError,
  deleteFolder,
  nestFolder,
  renameFolder,
  updateFolderCustomization,
} from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { isValidIcon, isValidColor } from "@/lib/fieldValidation";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string; folderId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { folderId } = await params;
  const id = parseId(folderId);
  if (id === null) return Response.json({ error: "Folder not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);

  if ("parentFolderId" in body && (typeof body.parentFolderId === "number" || body.parentFolderId === null)) {
    try {
      await nestFolder(id, body.parentFolderId as number | null);
    } catch (err) {
      if (err instanceof CannotNestFolderError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return Response.json({ ok: true });
  }

  if ("icon" in body || "color" in body) {
    const customization: { icon?: string | null; color?: string | null } = {};
    if ("icon" in body) {
      if (body.icon !== null && !isValidIcon(body.icon)) {
        return Response.json({ error: "Invalid icon" }, { status: 400 });
      }
      customization.icon = body.icon as string | null;
    }
    if ("color" in body) {
      if (body.color !== null && !isValidColor(body.color)) {
        return Response.json({ error: "Invalid color" }, { status: 400 });
      }
      customization.color = body.color as string | null;
    }
    await updateFolderCustomization(id, customization);
    return Response.json({ ok: true });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
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
