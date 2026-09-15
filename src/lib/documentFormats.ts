// Single source of truth for which document formats can be uploaded, and
// how each one is handled — shared by the upload route (validation +
// extraction routing), the viewer (GET route content-type + which viewer
// component the frontend picks), and the upload dialog's file input. No
// server-only imports here (nothing from node:*) so it's safe to import
// from client components too.
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;
export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "odt", "pptx", ...IMAGE_EXTENSIONS] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function isSupportedExtension(ext: string): ext is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

export function isImageExtension(ext: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

// odt/pptx have no pure-JS viewer or text extractor in this app — they're
// converted to PDF via a local LibreOffice install (lib/libreoffice.ts) and
// from then on ride the exact same PdfViewer + extractPdfText pipeline
// already built for real PDFs. pdf needs no conversion; docx gets its own
// pure-JS path (docx-preview to view, mammoth to extract) so it works with
// no external dependency. Images need no conversion either — they're just
// rendered as-is (see ImageViewer.tsx) and never have text extracted (no
// OCR — see markDocumentImage in lib/models.ts).
export function needsLibreOfficeConversion(ext: SupportedExtension): boolean {
  return ext === "odt" || ext === "pptx";
}

export const CONTENT_TYPES: Record<SupportedExtension, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export const UPLOAD_ACCEPT = [
  ".pdf",
  ".docx",
  ".odt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ...new Set(Object.values(CONTENT_TYPES)),
].join(",");
