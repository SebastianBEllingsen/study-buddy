import {
  deleteNote,
  getNote,
  getNoteBacklinks,
  InvalidDestinationFolderError,
  moveNote,
  renameNote,
  updateNoteIcon,
  updateNoteMarkdown,
} from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { isValidIcon } from "@/lib/fieldValidation";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ noteId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { noteId } = await params;
  const id = parseId(noteId);
  if (id === null) return Response.json({ error: "Note not found" }, { status: 404 });

  const note = await getNote(id);
  if (!note) return Response.json({ error: "Note not found" }, { status: 404 });

  const backlinks = await getNoteBacklinks(id);
  return Response.json({ note, backlinks });
}

export async function PATCH(request: Request, { params }: Params) {
  const { noteId } = await params;
  const id = parseId(noteId);
  if (id === null) return Response.json({ error: "Note not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);

  try {
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
      await renameNote(id, title);
    }
    if (typeof body.markdown === "string") {
      await updateNoteMarkdown(id, body.markdown);
    }
    if (Number.isInteger(body.folderId)) {
      await moveNote(id, body.folderId as number);
    }
    if ("icon" in body) {
      if (body.icon !== null && !isValidIcon(body.icon)) {
        return Response.json({ error: "Invalid icon" }, { status: 400 });
      }
      await updateNoteIcon(id, body.icon as string | null);
    }
  } catch (err) {
    if (err instanceof InvalidDestinationFolderError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't update note" }, { status: 409 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { noteId } = await params;
  const id = parseId(noteId);
  if (id === null) return Response.json({ error: "Note not found" }, { status: 404 });
  await deleteNote(id);
  return new Response(null, { status: 204 });
}
