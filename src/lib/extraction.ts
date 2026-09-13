import { getDocumentProxy, extractText } from "unpdf";

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
