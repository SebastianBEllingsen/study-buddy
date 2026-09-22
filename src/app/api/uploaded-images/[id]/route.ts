import { deleteUploadedImage, getUploadedImage, isUploadedImageReferencedInContent } from "@/lib/models";
import { cleanupReplacedImage } from "@/lib/blobStorage/cleanup";
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
  // Fetched before deleting so cleanupReplacedImage can check whether the
  // underlying blob is still referenced elsewhere (a course, or the app's
  // branding) once this library row is gone — see its own comment.
  const existing = await getUploadedImage(id);
  if (!existing) return new Response(null, { status: 204 });
  // Notes and canvases embed this row by id (studybuddy-image:<id> / image:<id>), which
  // cleanupReplacedImage's url-based check below can't see — deleting it
  // out from under one would leave a permanently broken image with no
  // way to recover which picture it used to be.
  if (await isUploadedImageReferencedInContent(id)) {
    return Response.json(
      { error: "This image is used in a note or canvas — remove it there first." },
      { status: 409 }
    );
  }
  await deleteUploadedImage(id);
  await cleanupReplacedImage(existing.url);
  return new Response(null, { status: 204 });
}
