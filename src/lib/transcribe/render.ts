// Turning a document's pages into images in the browser, to send to the AI
// (see service.ts). Client-only: it needs a canvas.

// Long enough side for small print and subscripts to stay readable, short
// enough to keep each page to a few hundred KB.
export const TARGET_LONG_SIDE = 1600;
export const JPEG_QUALITY = 0.85;

// How much to scale a page of this size so its longer side is `target`; an
// image is only ever shrunk (`maxScale` 1), a PDF page may be enlarged.
export function fitScale(width: number, height: number, target = TARGET_LONG_SIDE, maxScale = 4): number {
  const long = Math.max(width, height);
  return long > 0 ? Math.min(maxScale, target / long) : 1;
}

export interface PageSource {
  pageCount: number;
  // Page numbers start at 1. Resolves to a JPEG data URL.
  render(page: number): Promise<string>;
  destroy(): void | Promise<void>;
}

export async function openPdfPages(url: string): Promise<PageSource> {
  const pdfjs = await import("pdfjs-dist");
  // Same worker setup as the PDF viewer (components/PdfViewer.tsx).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ url });
  const pdf = await task.promise;
  return {
    pageCount: pdf.numPages,
    async render(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: fitScale(base.width, base.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        // The "print" intent: pdf.js steps an on-screen render with
        // requestAnimationFrame, which a background tab never runs — a long
        // transcription would freeze the moment you looked at another tab.
        await page.render({ canvas, viewport, intent: "print" }).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        canvas.width = 0;
        canvas.height = 0;
        return dataUrl;
      } finally {
        page.cleanup();
      }
    },
    destroy: () => task.destroy(),
  };
}

// A photo or scan: one page, shrunk if it's larger than it needs to be.
export async function openImagePage(url: string): Promise<PageSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Couldn't load the image.");
  const bitmap = await createImageBitmap(await response.blob());
  return {
    pageCount: 1,
    async render() {
      const scale = fitScale(bitmap.width, bitmap.height, TARGET_LONG_SIDE, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn't draw the image.");
      // JPEG has no transparency: a transparent PNG would come out black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl;
    },
    destroy: () => bitmap.close(),
  };
}
