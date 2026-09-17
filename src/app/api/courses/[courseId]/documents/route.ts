import { getFolder, getOrCreateDefaultFolder } from "@/lib/models";
import { ingestDocumentBytes, UnsupportedDocumentTypeError } from "@/lib/documentIngest";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    // Omitted (rather than required) so an empty course with no folders yet
    // can still be uploaded into — see getOrCreateDefaultFolder.
    const folderIdRaw = formData.get("folderId");
    const explicitFolderId = folderIdRaw === null ? null : Number(folderIdRaw);
    if (!(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (explicitFolderId !== null && !Number.isInteger(explicitFolderId)) {
      return Response.json({ error: "Invalid folder" }, { status: 400 });
    }
    const folderId = explicitFolderId ?? (await getOrCreateDefaultFolder(id)).id;
    // Validated up front, before anything is written to disk — createDocument
    // enforces this same check (see its own comment), but checking here too
    // means a crafted explicitFolderId from another course 400s cleanly
    // instead of leaving an orphaned file on disk after createDocument
    // rejects it.
    if (explicitFolderId !== null) {
      const folder = await getFolder(explicitFolderId);
      if (!folder || folder.course_id !== id) {
        return Response.json({ error: "Invalid folder" }, { status: 400 });
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const doc = await ingestDocumentBytes({ courseId: id, folderId, filename: file.name, buffer });

    return Response.json({ documentId: doc.id }, { status: 201 });
  } catch (err) {
    if (err instanceof UnsupportedDocumentTypeError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Document upload failed:", err);
    return Response.json({ error: "Couldn't upload this file" }, { status: 500 });
  }
}
