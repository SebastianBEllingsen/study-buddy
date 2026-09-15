import { getDocumentProxy, extractText } from "unpdf";
import mammoth from "mammoth";

export interface ExtractionResult {
  text: string;
  pageCount: number;
  charCount: number;
}

export class ScannedPdfError extends Error {
  constructor() {
    super(
      "This looks like a scanned or image-only PDF — OCR isn't supported yet."
    );
    this.name = "ScannedPdfError";
  }
}

export class EmptyDocumentError extends Error {
  constructor() {
    super("Couldn't find any readable text in this file.");
    this.name = "EmptyDocumentError";
  }
}

// A real text-based PDF page has, in practice, at least a handful of
// characters of extractable text. If the average per-page yield falls below
// this, the PDF was very likely scanned/image-only rather than genuinely
// near-empty, so we surface a clear failure instead of silently generating
// study material from nothing.
const MIN_CHARS_PER_PAGE = 20;

export async function extractPdfText(
  buffer: Buffer
): Promise<ExtractionResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text: rawText } = await extractText(pdf, { mergePages: true });
  // Malformed content streams / odd encodings occasionally yield stray NUL
  // bytes, which break things downstream (CLI args, some storage layers) and
  // carry no meaning in the extracted text anyway — strip at the source so
  // every consumer gets clean text.
  const text = rawText.replace(/\0/g, "");
  const charCount = text.trim().length;

  if (totalPages === 0 || charCount / Math.max(totalPages, 1) < MIN_CHARS_PER_PAGE) {
    throw new ScannedPdfError();
  }

  return { text, pageCount: totalPages, charCount };
}

// Roughly what a dense text page holds — docx has no real page concept
// (that's a rendering-time property, not a document property), so this is
// only used to give the "extracted, Np" badge a plausible number rather
// than leaving it blank.
const APPROX_CHARS_PER_PAGE = 2000;

export async function extractDocxText(buffer: Buffer): Promise<ExtractionResult> {
  const { value: rawText } = await mammoth.extractRawText({ buffer });
  const text = rawText.replace(/\0/g, "");
  const charCount = text.trim().length;

  if (charCount < MIN_CHARS_PER_PAGE) {
    throw new EmptyDocumentError();
  }

  return { text, pageCount: Math.max(1, Math.round(charCount / APPROX_CHARS_PER_PAGE)), charCount };
}
