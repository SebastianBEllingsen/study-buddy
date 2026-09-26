import fs from "node:fs/promises";
import {
  deleteDocument,
  getDocument,
  getDocumentBytes,
  getDocumentFile,
  InvalidDestinationFolderError,
  moveDocument,
  renameDocument,
  setDocumentTrust,
} from "@/lib/models";
import { parseTrust } from "@/lib/sources/requests";
import { parseId } from "@/lib/routeParams";
import { previewPdfPath } from "@/lib/uploads";
import { CONTENT_TYPES, extensionOf, isSupportedExtension, needsLibreOfficeConversion } from "@/lib/documentFormats";
import { convertToPdf } from "@/lib/libreoffice";

type Params = { params: Promise<{ courseId: string; documentId: string }> };

// Serves the original file for viewing: the local on-disk copy if this is
// the device it was uploaded from (fast path, works offline), else the
// synced file_base64 copy from the database. Neither present -> 404, which
// the frontend (DocumentContent.tsx) treats as "show extracted text instead."
//
// pdf and docx are served as-is — PdfViewer and DocxViewer render the real
// bytes client-side. odt/pptx have no such viewer, so this instead serves a
// LibreOffice-converted PDF of them (same pipeline as at upload time — see
// documents/route.ts): the cached copy at previewPdfPath if one was made at
// upload, or a freshly converted (and then cached) one if this device only
// ever synced the original bytes.
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return new Response(null, { status: 404 });
  const doc = await getDocumentFile(id);
  if (!doc) {
    return new Response(null, { status: 404 });
  }

  const ext = extensionOf(doc.filename);
  if (!isSupportedExtension(ext)) {
    return new Response(null, { status: 404 });
  }

  const headers = {
    "Content-Type": needsLibreOfficeConversion(ext) ? CONTENT_TYPES.pdf : CONTENT_TYPES[ext],
    "Content-Disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`,
  };

  if (needsLibreOfficeConversion(ext)) {
    const cachePath = previewPdfPath(doc.file_path);
    try {
      const cached = await fs.readFile(cachePath);
      return new Response(new Uint8Array(cached), { headers });
    } catch {
      // Not cached on this device yet — fall through to convert below.
    }

    const original = await getDocumentBytes(doc);
    if (!original) return new Response(null, { status: 404 });
    try {
      const converted = await convertToPdf(original, ext);
      fs.writeFile(cachePath, converted).catch(() => {
        // Best-effort cache write — a failure here just means the next
        // view on this device converts again instead of hitting the cache.
      });
      return new Response(new Uint8Array(converted), { headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  const original = await getDocumentBytes(doc);
  if (!original) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(original), { headers });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return new Response(null, { status: 204 });
  const doc = await getDocument(id);
  if (doc) {
    await fs.rm(doc.file_path, { force: true });
    await fs.rm(previewPdfPath(doc.file_path), { force: true });
    await deleteDocument(id);
  }
  return new Response(null, { status: 204 });
}

// Moves and/or renames — a plain move (drag-and-drop) sends only folderId,
// a rename sends only filename, either can be sent together. { trust }
// marks it official (authoritative) material or personal notes.
export async function PATCH(request: Request, { params }: Params) {
  const { documentId } = await params;
  const id = parseId(documentId);
  if (id === null) return Response.json({ error: "Document not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const hasFolderId = body?.folderId !== undefined;
  const hasFilename = body?.filename !== undefined;
  const hasTrust = body?.trust !== undefined;

  if (!hasFolderId && !hasFilename && !hasTrust) {
    return Response.json({ error: "folderId, filename or trust is required" }, { status: 400 });
  }
  const trust = hasTrust ? parseTrust(body.trust) : null;
  if (hasTrust && !trust) return Response.json({ error: "Invalid trust" }, { status: 400 });

  try {
    if (trust) {
      const doc = await getDocument(id);
      if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });
      await setDocumentTrust(id, trust);
    }

    if (hasFolderId) {
      if (body.folderId !== null && !Number.isInteger(body.folderId)) {
        return Response.json({ error: "Invalid folder" }, { status: 400 });
      }
      await moveDocument(id, body.folderId);
    }

    if (hasFilename) {
      const requested = typeof body.filename === "string" ? body.filename.trim() : "";
      if (!requested) {
        return Response.json({ error: "Name can't be empty" }, { status: 400 });
      }
      const doc = await getDocument(id);
      if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

      // A pasted-text "document" (file_path === "") has no real underlying
      // file, so its filename is just a title — rename it freely. A real
      // upload's filename extension drives which viewer/content-type is used
      // (see documentFormats.ts) and must keep matching the actual stored
      // bytes, so it's preserved here regardless of what the client sent —
      // silently correcting a dropped/changed extension rather than erroring,
      // since that's almost always just the user editing the visible name in
      // a rename box that also shows the extension.
      let filename = requested;
      if (doc.file_path !== "") {
        const currentExt = extensionOf(doc.filename);
        if (currentExt && extensionOf(requested) !== currentExt) {
          const base = requested.includes(".") ? requested.slice(0, requested.lastIndexOf(".")) : requested;
          filename = `${base}.${currentExt}`;
        }
      }
      await renameDocument(id, filename);
    }
  } catch (err) {
    if (err instanceof InvalidDestinationFolderError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Document update failed:", err);
    return Response.json({ error: "Couldn't update this document" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
