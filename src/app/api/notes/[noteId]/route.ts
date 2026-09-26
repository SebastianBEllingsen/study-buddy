import {
  deleteNote,
  getCanvasBacklinksForNote,
  getNote,
  getNoteBacklinks,
  InvalidDestinationFolderError,
  moveNote,
  renameNote,
  setNoteGenerationSource,
  updateNoteIcon,
  updateNoteMarkdown,
} from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { isValidIcon } from "@/lib/fieldValidation";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { parseGenerationSource } from "@/lib/sources/requests";

type Params = { params: Promise<{ noteId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { noteId } = await params;
  const id = parseId(noteId);
  if (id === null) return Response.json({ error: "Note not found" }, { status: 404 });

  const note = await getNote(id);
  if (!note) return Response.json({ error: "Note not found" }, { status: 404 });

  const [backlinks, canvasBacklinks] = await Promise.all([getNoteBacklinks(id), getCanvasBacklinksForNote(id)]);
  return Response.json({ note, backlinks, canvasBacklinks });
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
    if (body.folderId === null || Number.isInteger(body.folderId)) {
      await moveNote(id, body.folderId as number | null);
    }
    if ("icon" in body) {
      if (body.icon !== null && !isValidIcon(body.icon)) {
        return Response.json({ error: "Invalid icon" }, { status: 400 });
      }
      await updateNoteIcon(id, body.icon as string | null);
    }
    // null: not used for generation; "official" / "personal": included.
    if ("generationSource" in body) {
      const source = parseGenerationSource(body.generationSource);
      if (source === undefined) return Response.json({ error: "Invalid generation source" }, { status: 400 });
      await setNoteGenerationSource(id, source);
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
