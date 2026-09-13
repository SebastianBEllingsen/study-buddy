import type { CropRect } from "@/components/ask-ai/useCropToAsk";

// Rasterizes just the selected rectangle of `el` — for any content view
// that isn't a <canvas> (PDF pages read pixels straight off their own
// canvas instead; see PdfViewer.tsx). html2canvas's own x/y/width/height
// options crop during rendering rather than after, so this never rasterizes
// more of the page than the user actually selected.
export async function captureElementRegion(
  el: HTMLElement,
  rect: CropRect
): Promise<string | null> {
  const elRect = el.getBoundingClientRect();
  const left = Math.max(rect.left, elRect.left);
  const top = Math.max(rect.top, elRect.top);
  const width = Math.min(rect.left + rect.width, elRect.right) - left;
  const height = Math.min(rect.top + rect.height, elRect.bottom) - top;
  if (width < 8 || height < 8) return null;

  // html2canvas-pro, not the original html2canvas — this app's design
  // tokens (globals.css) use OKLCH colors, and vanilla html2canvas's CSS
  // color parser throws on "oklch"/"lab" color functions it predates
  // (confirmed via a live crop attempt: "Attempting to parse an unsupported
  // color function \"lab\""). The -pro fork is a drop-in replacement with
  // the same API that added support for these.
  const { default: html2canvas } = await import("html2canvas-pro");
  const canvas = await html2canvas(el, {
    x: left - elRect.left,
    y: top - elRect.top,
    width,
    height,
    backgroundColor: null,
  });
  return canvas.toDataURL("image/png");
}
