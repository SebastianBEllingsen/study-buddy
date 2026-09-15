import { deleteUploadedImage, getUploadedImage } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ id: string }> };

// Resolves a studybuddy-image:<id> reference embedded in a note (see
// NoteEditor.tsx) back into its real data URL for rendering.
export async function GET(_request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return Response.json({ error: "Image not found" }, { status: 404 });
  const image = await getUploadedImage(id);
  if (!image) return Response.json({ error: "Image not found" }, { status: 404 });
  return Response.json({ image });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return new Response(null, { status: 204 });
  await deleteUploadedImage(id);
  return new Response(null, { status: 204 });
}
