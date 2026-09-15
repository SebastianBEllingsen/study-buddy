// Just the <img> itself — the container, scrolling, and Crop & Ask toolbar
// all live in DocumentContent (same as its pasted/extracted-text fallback
// view). No OCR (see README's Known limitations), so unlike PdfViewer/
// DocxViewer there's no companion text-extraction step — see
// markDocumentImage in lib/models.ts.
export default function ImageViewer({ url, filename }: { url: string; filename: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- an uploaded document, not a next/image-optimizable asset
  return <img src={url} alt={filename} className="mx-auto block max-w-full rounded-md" />;
}
