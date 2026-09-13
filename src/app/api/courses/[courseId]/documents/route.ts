import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createDocument, markDocumentExtracted, markDocumentFailed } from "@/lib/models";
import { uploadsDir } from "@/lib/uploads";
import { extractPdfText, ScannedPdfError } from "@/lib/extraction";

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = Number(courseId);

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const folderId = Number(formData.get("folderId"));
    if (!(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!Number.isInteger(folderId)) {
      return Response.json({ error: "A folder is required for uploads" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return Response.json({ error: "Only PDF files are supported" }, { status: 400 });
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
      const { text, pageCount, charCount } = await extractPdfText(buffer);
      await markDocumentExtracted({ id: doc.id, extractedText: text, pageCount, charCount });
    } catch (err) {
      const message =
        err instanceof ScannedPdfError ? err.message : "Failed to extract text from this PDF.";
      await markDocumentFailed(doc.id, message);
    }

    return Response.json({ documentId: doc.id }, { status: 201 });
  } catch (err) {
    console.error("Document upload failed:", err);
    return Response.json({ error: "Couldn't upload this file" }, { status: 500 });
  }
}
