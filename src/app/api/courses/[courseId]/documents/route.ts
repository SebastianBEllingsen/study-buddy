import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  createDocument,
  getOrCreateDefaultFolder,
  markDocumentExtracted,
  markDocumentFailed,
  markDocumentImage,
} from "@/lib/models";
import { uploadsDir, previewPdfPath } from "@/lib/uploads";
import { extractPdfText, extractDocxText, ScannedPdfError, EmptyDocumentError } from "@/lib/extraction";
import { convertToPdf, LibreOfficeUnavailableError } from "@/lib/libreoffice";
import { extensionOf, isSupportedExtension, isImageExtension, needsLibreOfficeConversion } from "@/lib/documentFormats";
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
    const ext = extensionOf(file.name);
    if (!isSupportedExtension(ext)) {
      return Response.json(
        { error: "Only PDF, DOCX, ODT, PPTX, and image files are supported" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const dir = uploadsDir(id);
    // The on-disk name is unique regardless of the uploaded filename —
    // two documents named the same (a common case: lecture slides across
    // different weeks are often all "slides.pdf") must never share a path,
    // or the second upload silently overwrites the first's bytes on disk
    // while both document rows still believe they own that path (both for
    // viewing via the GET route's disk-read fast path, and for deletion,
    // where removing one would delete the file the other still needs).
    // `filename` (shown to the user) stays exactly what they uploaded.
    const filePath = path.join(dir, `${crypto.randomUUID()}-${file.name}`);
    await fs.writeFile(filePath, buffer);

    const doc = await createDocument({
      courseId: id,
      folderId,
      filename: file.name,
      filePath,
      fileBase64: buffer.toString("base64"),
    });

    try {
      if (isImageExtension(ext)) {
        // No OCR (see README's Known limitations) — an image has nothing to
        // extract by design, not a failure, so it gets its own status
        // rather than "failed": still fully viewable (ImageViewer) and
        // Crop & Ask-able, just never picked up as generation source
        // material (see getNewDocumentsForItem/context.ts).
        await markDocumentImage(doc.id);
      } else if (ext === "pdf") {
        const { text, pageCount, charCount } = await extractPdfText(buffer);
        await markDocumentExtracted({ id: doc.id, extractedText: text, pageCount, charCount });
      } else if (ext === "docx") {
        const { text, pageCount, charCount } = await extractDocxText(buffer);
        await markDocumentExtracted({ id: doc.id, extractedText: text, pageCount, charCount });
      } else if (needsLibreOfficeConversion(ext)) {
        // Converted once here rather than on-demand in the viewing route —
        // by the time the user actually opens it, it's already cached on
        // disk (see previewPdfPath) instead of making their first view wait
        // out a multi-second LibreOffice conversion.
        const pdfBuffer = await convertToPdf(buffer, ext);
        await fs.writeFile(previewPdfPath(filePath), pdfBuffer);
        const { text, pageCount, charCount } = await extractPdfText(pdfBuffer);
        await markDocumentExtracted({ id: doc.id, extractedText: text, pageCount, charCount });
      }
    } catch (err) {
      let message = "Failed to extract text from this file.";
      if (err instanceof ScannedPdfError || err instanceof EmptyDocumentError) {
        message = err.message;
      } else if (err instanceof LibreOfficeUnavailableError) {
        message = err.message;
      }
      await markDocumentFailed(doc.id, message);
    }

    return Response.json({ documentId: doc.id }, { status: 201 });
  } catch (err) {
    console.error("Document upload failed:", err);
    return Response.json({ error: "Couldn't upload this file" }, { status: 500 });
  }
}
