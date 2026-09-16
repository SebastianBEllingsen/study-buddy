"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
// PDF.js's own stylesheet for .textLayer — hand-rolling the positioning
// math (font scaling, rotation, selection color) correctly is genuinely
// hard to get pixel-perfect; this is the same file their own viewer ships,
// scoped under specific class names (.textLayer, .page, ...) unlikely to
// collide with this app's Tailwind utility classes.
import "pdfjs-dist/web/pdf_viewer.css";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Download } from "lucide-react";
import { scrollToHighlight } from "@/lib/scrollToHighlight";
import { prefersReducedMotion } from "@/lib/motion";
import { AskAiPanel } from "@/components/ask-ai/AskAiPanel";
import { useCropToAsk, type CropRect } from "@/components/ask-ai/useCropToAsk";
import {
  CropToAskButton,
  CropSelectionOverlay,
  CropPreviewCard,
  CropAskThread,
} from "@/components/ask-ai/CropToAskUI";

// The modern bundler-friendly way to point PDF.js at its worker file —
// Next.js's asset bundling (webpack and Turbopack both) resolves
// `new URL(..., import.meta.url)` to a fingerprinted static file.
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const SCALE_STEP = 0.05;
const DEFAULT_SCALE = 1;

function PdfPage({
  page,
  scale,
  registerPageEl,
  onTextLayerReady,
  onRenderStateChange,
}: {
  page: PDFPageProxy;
  scale: number;
  registerPageEl: (pageNumber: number, el: HTMLDivElement | null) => void;
  onTextLayerReady: (pageNumber: number, el: HTMLDivElement) => void;
  // Reports null the instant a (re-)render starts (a scale change mid-flight
  // leaves the canvas showing stale content from the previous scale until
  // this resolves — sometimes for several seconds across many pages at
  // once, see capturePdfRegion below) and the actual scale once the canvas
  // pixels themselves are confirmed painted for it — not gated on the text
  // layer, which crop-to-ask doesn't need.
  onRenderStateChange: (pageNumber: number, renderedScale: number | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  const viewport = page.getViewport({ scale });

  // Registers this page's wrapper with the parent (for scrollIntoView) and
  // lazily renders only once it's actually near the viewport, so a 30+
  // page PDF doesn't render every page upfront.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    registerPageEl(page.pageNumber, el);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      registerPageEl(page.pageNumber, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (!inView) return;
    const canvas = canvasRef.current;
    const textLayerEl = textLayerRef.current;
    if (!canvas || !textLayerEl) return;
    let cancelled = false;
    let renderTask: ReturnType<typeof page.render> | null = null;

    onRenderStateChange(page.pageNumber, null);

    // A previous render on this exact <canvas> (from the scale this effect
    // is replacing) might still be in the process of releasing it — calling
    // .cancel() in that run's cleanup below doesn't guarantee that's already
    // finished by the time this one starts, and pdf.js throws synchronously
    // — "Cannot use the same canvas during multiple render() operations" —
    // if page.render() is called again before it has. Several scale changes
    // firing in quick succession (e.g. clicking zoom-in repeatedly) used to
    // hit this often enough to matter: not just failing that one attempt
    // (their bounding box already matched the new scale even though their
    // pixels didn't, which is what made crop-to-ask capture the wrong
    // content), but on an earlier version of this fix, permanently — a
    // failed attempt was chained into a persistent per-page promise every
    // later attempt awaited, so one uncaught failure blocked every
    // subsequent render for that page for the rest of the session, and nothing
    // in this effect stays around across renders to un-stick it. A bounded
    // retry loop scoped entirely to this one effect run has no such
    // failure mode — nothing here outlives this run, so there's nothing left
    // to get stuck.
    (async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          renderTask = page.render({ canvas, viewport });
          await renderTask.promise;
          if (cancelled) return;
          onRenderStateChange(page.pageNumber, scale);
          const textContent = await page.getTextContent();
          if (cancelled) return;
          textLayerEl.replaceChildren();
          const textLayer = new TextLayer({
            textContentSource: textContent,
            container: textLayerEl,
            viewport,
          });
          await textLayer.render();
          if (!cancelled) onTextLayerReady(page.pageNumber, textLayerEl);
          return;
        } catch (err) {
          if (cancelled) return;
          const canvasBusy = err instanceof Error && err.message.includes("same canvas");
          // Anything else (cancellation, a genuine render error) isn't
          // worth retrying — give up silently, same as before.
          if (!canvasBusy || attempt === 4) return;
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, scale]);

  return (
    <div
      ref={wrapperRef}
      className="relative mx-auto mb-3 bg-white shadow-sm"
      style={
        {
          width: viewport.width,
          height: viewport.height,
          ["--total-scale-factor"]: scale,
          ["--scale-factor"]: scale,
        } as React.CSSProperties
      }
      data-page-number={page.pageNumber}
    >
      <canvas ref={canvasRef} className="block" />
      <div ref={textLayerRef} className="textLayer" />
    </div>
  );
}

export default function PdfViewer({
  url,
  filename,
  askEndpoint,
  highlight,
}: {
  url: string;
  filename: string;
  askEndpoint: string;
  highlight?: string | null;
}) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [error, setError] = useState<string | null>(null);
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const highlightedRef = useRef(false);
  // Which scale each page's canvas is actually painted at right now — null
  // while a render is in flight for it. See capturePdfRegion, which waits on
  // this before reading pixels; see PdfPage's onRenderStateChange for why a
  // scale change alone doesn't mean the canvas is ready yet (rendering 30+
  // pages at once after a zoom change can visibly take several seconds).
  const pageRenderedScaleRef = useRef<Map<number, number | null>>(new Map());

  function handlePageRenderStateChange(pageNumber: number, renderedScale: number | null) {
    pageRenderedScaleRef.current.set(pageNumber, renderedScale);
  }

  // Screenshot-crop-to-ask: drag a rectangle over a rendered page and ask AI
  // about just that region — for diagrams/equations/charts that a plain
  // text selection (AskAiPanel below) can't capture. Reads pixels straight
  // off the page's own <canvas> (captureRegion below) rather than going
  // through the generic html2canvas path other content views use (see
  // lib/cropCapture.ts) — faster and pixel-perfect since the content is
  // already a canvas.
  async function capturePdfRegion(rect: CropRect): Promise<string | null> {
    const pageEl = document
      .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ?.closest("[data-page-number]");
    const canvas = pageEl?.querySelector("canvas");
    if (!canvas || !pageEl) return null;

    // Wait for THIS page's canvas to be confirmed painted at the CURRENT
    // scale before reading a single pixel from it. Without this, cropping
    // shortly after a zoom change (while pages are still mid-redraw) could
    // read a stale buffer still showing a previous scale's content — its
    // bounding box already reflects the new size/position (that's set
    // synchronously, before the repaint), so the crop rect would look
    // correctly placed while actually slicing into unrelated leftover
    // pixels. A few seconds' grace, then give up rather than risk another
    // wrong-content capture.
    const pageNumber = Number(pageEl.getAttribute("data-page-number"));
    const deadline = Date.now() + 4000;
    while (pageRenderedScaleRef.current.get(pageNumber) !== scale) {
      if (Date.now() > deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    // Clamp to the page it landed on — a drag that strays onto a
    // neighboring page (or the page's own margin) just gets cropped to
    // what's actually available. Re-read live rather than reusing anything
    // measured before the wait above, in case scrolling shifted it.
    const canvasRect = canvas.getBoundingClientRect();
    const left = Math.max(rect.left, canvasRect.left);
    const top = Math.max(rect.top, canvasRect.top);
    const width = Math.min(rect.left + rect.width, canvasRect.right) - left;
    const height = Math.min(rect.top + rect.height, canvasRect.bottom) - top;
    if (width < 8 || height < 8) return null;

    // The canvas's intrinsic pixel size equals its CSS size (see PdfPage —
    // canvas.width/height are set directly from the viewport, with no
    // separate CSS width/height override), so client-pixel deltas map 1:1
    // onto canvas pixels with no DPR/zoom scaling to account for.
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.round(width);
    cropCanvas.height = Math.round(height);
    const ctx = cropCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      canvas,
      left - canvasRect.left,
      top - canvasRect.top,
      width,
      height,
      0,
      0,
      width,
      height
    );
    return cropCanvas.toDataURL("image/png");
  }

  const {
    cropMode,
    cropRect,
    toggleCropMode,
    handleMouseDown: handleCropMouseDown,
    handleMouseMove: handleCropMouseMove,
    handleMouseUp: handleCropMouseUp,
    pending: cropPending,
    question: cropQuestion,
    setQuestion: setCropQuestion,
    confirmAsk: confirmCropAsk,
    cancelPending: cancelCropPending,
    image: cropImage,
    turns: cropTurns,
    askFollowUp: askCropFollowUp,
    loading: cropLoading,
    error: cropError,
    dismiss: dismissCrop,
  } = useCropToAsk(askEndpoint, capturePdfRegion);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = getDocument({ url });
    loadingTask.promise
      .then(async (pdf: PDFDocumentProxy) => {
        const loaded = await Promise.all(
          Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1))
        );
        if (!cancelled) setPages(loaded);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this PDF.");
      });
    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [url]);

  // Finds which page contains a pending search-result match — cheap, since
  // getTextContent() doesn't render anything, just reads text.
  useEffect(() => {
    if (!highlight || pages.length === 0) return;
    let cancelled = false;
    const needle = highlight.trim().toLowerCase();
    (async () => {
      for (const page of pages) {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .toLowerCase();
        if (text.includes(needle)) {
          if (!cancelled) setTargetPage(page.pageNumber);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [highlight, pages]);

  useEffect(() => {
    if (targetPage == null) return;
    pageElsRef.current.get(targetPage)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, [targetPage]);

  function registerPageEl(pageNumber: number, el: HTMLDivElement | null) {
    if (el) pageElsRef.current.set(pageNumber, el);
    else pageElsRef.current.delete(pageNumber);
  }

  function handleTextLayerReady(pageNumber: number, textLayerEl: HTMLDivElement) {
    if (highlightedRef.current || !highlight || pageNumber !== targetPage) return;
    highlightedRef.current = true;
    scrollToHighlight(textLayerEl, highlight);
  }

  // Zooming resizes every page by the same factor, but the container's
  // scrollTop/scrollLeft don't — left alone, the same pixel offset now
  // points at completely different content (zoom in and everything above
  // got taller, so you're suddenly looking at an earlier page). Anchoring
  // on whatever's at the center of the viewport (as a fraction of total
  // scrollHeight/scrollWidth, not absolute pixels) and re-deriving the
  // scroll position from that same fraction after the resize keeps it
  // centered on the same spot instead. Captured just before the scale
  // change and consumed by the layout effect below, once — not on every
  // scroll — this only ever fires right after an actual scale change (the
  // `next === s` bail-out skips capturing one that got clamped to a no-op).
  const pendingZoomAnchorRef = useRef<{ x: number; y: number } | null>(null);

  function captureZoomAnchor() {
    const el = containerRef.current;
    if (!el || el.scrollHeight === 0 || el.scrollWidth === 0) return null;
    return {
      y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
      x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
    };
  }

  function zoomBy(direction: 1 | -1) {
    setScale((s) => {
      const next =
        direction > 0
          ? Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(2))
          : Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(2));
      if (next === s) return s;
      pendingZoomAnchorRef.current = captureZoomAnchor();
      return next;
    });
  }

  // Runs synchronously after the resized page wrappers commit to the DOM
  // (their width/height are set straight from viewport.width/height in
  // PdfPage's render, not gated on the canvas itself finishing) but before
  // the browser paints, so the scroll jump this causes is never visible.
  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const el = containerRef.current;
    if (!anchor || !el) return;
    pendingZoomAnchorRef.current = null;
    el.scrollTop = anchor.y * el.scrollHeight - el.clientHeight / 2;
    el.scrollLeft = anchor.x * el.scrollWidth - el.clientWidth / 2;
  }, [scale]);


  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => zoomBy(-1)}
            aria-label="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <span className="w-10 text-center text-xs text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => zoomBy(1)}
            aria-label="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <CropToAskButton active={cropMode} onClick={toggleCropMode} />
        </div>
        <span className="text-xs text-muted-foreground">
          {cropMode
            ? "Drag over a region to ask about it"
            : pages.length > 0
              ? `${pages.length} page${pages.length === 1 ? "" : "s"}`
              : ""}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Download PDF"
          nativeButton={false}
          render={<a href={url} download={filename} />}
        >
          <Download className="size-3.5" />
        </Button>
      </div>
      <div
        ref={containerRef}
        className={`min-h-0 flex-1 overflow-auto bg-muted/50 p-4 ${cropMode ? "cursor-crosshair select-none" : ""}`}
        onMouseDown={handleCropMouseDown}
        onMouseMove={handleCropMouseMove}
        onMouseUp={handleCropMouseUp}
      >
        {error && <p className="text-center text-sm text-muted-foreground">{error}</p>}
        {!error && pages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        )}
        {pages.map((page) => (
          <PdfPage
            key={page.pageNumber}
            page={page}
            scale={scale}
            registerPageEl={registerPageEl}
            onTextLayerReady={handleTextLayerReady}
            onRenderStateChange={handlePageRenderStateChange}
          />
        ))}
      </div>
      <CropSelectionOverlay rect={cropRect} />
      {cropPending && (
        <div className="shrink-0 border-t p-2">
          <CropPreviewCard
            dataUrl={cropPending}
            question={cropQuestion}
            onQuestionChange={setCropQuestion}
            onConfirm={confirmCropAsk}
            onCancel={cancelCropPending}
            loading={cropLoading}
          />
        </div>
      )}
      {cropImage && (
        <div className="shrink-0 border-t p-2">
          <CropAskThread
            image={cropImage}
            turns={cropTurns}
            loading={cropLoading}
            error={cropError}
            question={cropQuestion}
            onQuestionChange={setCropQuestion}
            onAskFollowUp={askCropFollowUp}
            onDismiss={dismissCrop}
          />
        </div>
      )}
      <AskAiPanel endpoint={askEndpoint} containerRef={containerRef} kinds={["explain"]} />
    </div>
  );
}
