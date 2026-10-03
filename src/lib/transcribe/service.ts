import { generateText } from "../aiClient";
import { getAppSettings, getDocument, markDocumentTranscribed, markDocumentExtractedFromFile } from "../models";
import type { GenerateTextImage } from "../aiBackends/types";
import { extensionOf, isImageExtension, isSupportedExtension } from "../documentFormats";
import { joinPages, parsePages, transcribeSystemPrompt, transcribeUserPrompt } from "./prompt";
import { MAX_PAGES, MAX_PAGES_PER_CALL, type PageImage, type TranscribedPage } from "./types";

// Transcribing a document's pages with the AI (see prompt.ts). The browser
// renders the pages and sends them in small batches — so it can show
// progress and stop at any time — and finishes by committing the text, which
// replaces the document's text layer until restored.

export class TranscribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscribeError";
  }
}

const MAX_IMAGE_BASE64 = 4_000_000;
const MAX_TOTAL_CHARS = 2_000_000;
const TOKENS_PER_PAGE = 2500;

async function transcribable(courseId: number, documentId: number) {
  const doc = await getDocument(documentId);
  if (!doc || doc.course_id !== courseId) throw new TranscribeError("Document not found.");
  const ext = extensionOf(doc.filename);
  // docx has no page images to read (its equations are lost by the text
  // extractor, but it can't be rendered in the browser this way).
  if (!isSupportedExtension(ext) || ext === "docx") {
    throw new TranscribeError("This kind of file can't be transcribed — PDFs, slides and images can.");
  }
  return { doc, isImage: isImageExtension(ext) };
}

export async function transcribeBatch(courseId: number, documentId: number, images: PageImage[]): Promise<TranscribedPage[]> {
  await transcribable(courseId, documentId);
  if (images.length === 0 || images.length > MAX_PAGES_PER_CALL) {
    throw new TranscribeError(`Send between 1 and ${MAX_PAGES_PER_CALL} pages at a time.`);
  }
  const pages = images.map((i) => i.page);
  if (new Set(pages).size !== pages.length) throw new TranscribeError("Each page can only be sent once per batch.");
  for (const image of images) {
    if (image.base64.length > MAX_IMAGE_BASE64) throw new TranscribeError("A page image is too large.");
  }
  const { aiEfficiencyMode } = await getAppSettings();
  const reply = await generateText({
    system: transcribeSystemPrompt(),
    user: transcribeUserPrompt(pages),
    images: images.map((i): GenerateTextImage => ({ base64: i.base64, mimeType: i.mimeType })),
    maxTokens: Math.min(12_000, TOKENS_PER_PAGE * images.length),
    // Reading equations and handwriting is what quality matters for, so this
    // doesn't drop to a cheaper model unless efficiency mode asks for it.
    efficient: aiEfficiencyMode,
    effort: "low",
  });
  const parsed = parsePages(reply, pages);
  return pages.map((page) => ({ page, markdown: parsed.get(page) ?? "" }));
}

// Saves the transcription as the document's text.
export async function commitTranscription(courseId: number, documentId: number, pages: TranscribedPage[]): Promise<{ pageCount: number; charCount: number }> {
  const { doc } = await transcribable(courseId, documentId);
  if (pages.length === 0 || pages.length > MAX_PAGES) throw new TranscribeError(`A transcription has 1 to ${MAX_PAGES} pages.`);
  const ordered = [...pages].sort((a, b) => a.page - b.page);
  const text = joinPages(ordered.map((p) => p.markdown));
  if (text.length < 20) throw new TranscribeError("Nothing readable came back, so the document's text was left as it was.");
  if (text.length > MAX_TOTAL_CHARS) throw new TranscribeError("That transcription is too long to store.");
  const pageCount = Math.max(pages.length, doc.page_count ?? 0);
  await markDocumentTranscribed({ id: documentId, extractedText: text, pageCount });
  return { pageCount, charCount: text.length };
}

// Back to the file's own text layer — the undo for a transcription that
// came out badly. Only for files that have one.
export async function restoreFileText(courseId: number, documentId: number): Promise<void> {
  const { doc, isImage } = await transcribable(courseId, documentId);
  if (isImage) throw new TranscribeError("An image has no text of its own to go back to.");
  const { getDocumentFile, getDocumentBytes } = await import("../models");
  const file = await getDocumentFile(documentId);
  const bytes = file ? await getDocumentBytes(file) : null;
  if (!bytes) throw new TranscribeError("The original file isn't available on this computer.");
  const { extractPdfText, ScannedPdfError } = await import("../extraction");
  if (extensionOf(doc.filename) !== "pdf") {
    throw new TranscribeError("Only a PDF's text layer can be restored here.");
  }
  try {
    const { text, pageCount, charCount } = await extractPdfText(bytes);
    await markDocumentExtractedFromFile({ id: documentId, extractedText: text, pageCount, charCount });
  } catch (err) {
    if (err instanceof ScannedPdfError) throw new TranscribeError("This PDF has no text layer — it's a scan, so there's nothing to go back to.");
    throw err;
  }
}
