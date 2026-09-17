import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  createDocument,
  markDocumentExtracted,
  markDocumentFailed,
  markDocumentImage,
} from "./models";
import type { DocumentRow } from "./models";
import { uploadsDir, previewPdfPath } from "./uploads";
import { extractPdfText, extractDocxText, ScannedPdfError, EmptyDocumentError } from "./extraction";
import { convertToPdf, LibreOfficeUnavailableError } from "./libreoffice";
import { extensionOf, isSupportedExtension, isImageExtension, needsLibreOfficeConversion } from "./documentFormats";

export class UnsupportedDocumentTypeError extends Error {
  constructor() {
    super("Only PDF, DOCX, ODT, PPTX, and image files are supported");
    this.name = "UnsupportedDocumentTypeError";
  }
}

// Writes a document's bytes to disk, creates its DB row, and triggers the
// same extraction pipeline the course-page upload route always has —
// extracted here so it can be reused by anything that already has raw bytes
// in hand (the upload route itself, and aiBackends-adjacent chat actions
// that save a chat attachment into a course — see chatActions.ts) without
// going through an HTTP round-trip. Caller is responsible for validating
// that `folderId` actually belongs to `courseId` — createDocument enforces
// this too (InvalidDestinationFolderError), but a caller-side check avoids
// leaving an orphaned file on disk after createDocument rejects it.
export async function ingestDocumentBytes(params: {
  courseId: number;
  folderId: number;
  filename: string;
  buffer: Buffer;
}): Promise<DocumentRow> {
  const ext = extensionOf(params.filename);
  if (!isSupportedExtension(ext)) {
    throw new UnsupportedDocumentTypeError();
  }

  const dir = uploadsDir(params.courseId);
  // See the matching comment this was extracted from (courses/[courseId]/
  // documents/route.ts, pre-refactor) — the on-disk name must never collide
  // across documents, and must never let a crafted filename escape `dir`.
  const safeName = path.basename(params.filename);
  const filePath = path.join(dir, `${crypto.randomUUID()}-${safeName}`);
  if (!filePath.startsWith(dir + path.sep)) {
    throw new Error("Invalid filename");
  }
  await fs.writeFile(filePath, params.buffer);

  const doc = await createDocument({
    courseId: params.courseId,
    folderId: params.folderId,
    filename: params.filename,
    filePath,
    fileBase64: params.buffer.toString("base64"),
  });

  try {
    if (isImageExtension(ext)) {
      // No OCR — an image has nothing to extract by design, not a failure.
      await markDocumentImage(doc.id);
    } else if (ext === "pdf") {
      const { text, pageCount, charCount } = await extractPdfText(params.buffer);
      await markDocumentExtracted({ id: doc.id, extractedText: text, pageCount, charCount });
    } else if (ext === "docx") {
      const { text, pageCount, charCount } = await extractDocxText(params.buffer);
      await markDocumentExtracted({ id: doc.id, extractedText: text, pageCount, charCount });
    } else if (needsLibreOfficeConversion(ext)) {
      const pdfBuffer = await convertToPdf(params.buffer, ext);
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

  return doc;
}
