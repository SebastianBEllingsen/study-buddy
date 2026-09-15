import fs from "node:fs/promises";
import { deleteDocument, getDocument, getDocumentFile, moveDocument } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string; documentId: string }> };

// Serves the original PDF for viewing: the local on-disk copy if this is
// the device it was uploaded from (fast path, works offline), else the
// synced file_base64 copy from the database. Neither present -> 404, which
// the frontend (DocumentViewer.tsx) treats as "show extracted text instead."
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return new Response(null, { status: 404 });
  const doc = await getDocumentFile(id);
  if (!doc) {
    return new Response(null, { status: 404 });
  }

  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`,
  };

  try {
    const buffer = await fs.readFile(doc.file_path);
    return new Response(new Uint8Array(buffer), { headers });
  } catch {
    // Not on this device (ENOENT) — fall through to the synced copy.
  }

  if (doc.file_base64) {
    return new Response(new Uint8Array(Buffer.from(doc.file_base64, "base64")), { headers });
  }

  return new Response(null, { status: 404 });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return new Response(null, { status: 204 });
  const doc = await getDocument(id);
  if (doc) {
    await fs.rm(doc.file_path, { force: true });
    await deleteDocument(id);
  }
  return new Response(null, { status: 204 });
}

export async function PATCH(request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return Response.json({ error: "Document not found" }, { status: 404 });
  const body = await request.json();
  const folderId = body?.folderId;

  if (!Number.isInteger(folderId)) {
    return Response.json({ error: "folderId is required" }, { status: 400 });
  }

  await moveDocument(id, folderId);
  return Response.json({ ok: true });
}
