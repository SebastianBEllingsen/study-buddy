"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AskAiPanel } from "@/components/ask-ai/AskAiPanel";
import { AskAiAnswer } from "@/components/ask-ai/AskAiAnswer";
import { useCropToAsk } from "@/components/ask-ai/useCropToAsk";
import {
  CropToAskButton,
  CropSelectionOverlay,
  CropPreviewCard,
} from "@/components/ask-ai/CropToAskUI";
import { captureElementRegion } from "@/lib/cropCapture";
import { scrollToHighlight } from "@/lib/scrollToHighlight";
import PastedTextView from "@/components/PastedTextView";
import DocxViewer from "@/components/DocxViewer";
import ImageViewer from "@/components/ImageViewer";
import { Download } from "lucide-react";
import { extensionOf, isImageExtension } from "@/lib/documentFormats";

// pdfjs-dist assumes a browser (Worker, DOM) — loaded client-only so its
// module code never runs during SSR (it does, and warns, if imported
// statically: "Please use the legacy build in Node.js environments").
const PdfViewer = dynamic(() => import("@/components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  ),
});

export interface ViewedDocument {
  id: number;
  courseId: number;
  filename: string;
  extracted_text: string | null;
  // "" for pasted text (see documents/paste/route.ts) — distinguishes it
  // from a real PDF whose file just isn't available on this device, which
  // also falls back to this same extracted-text view but shouldn't offer
  // "Make pretty" (that would drift the text from the actual PDF it
  // represents).
  filePath: string;
}

// The actual PDF-or-extracted-text rendering, Crop & Ask, and highlight-to-
// explain — everything independent of whatever shell it's mounted in.
// Shared by DocumentViewer's in-app Dialog and the standalone "detached"
// window (app/documents/[documentId]/view/page.tsx), which pops this exact
// same viewer into its own browser window (e.g. for note-taking alongside
// it) rather than a cut-down copy.
//
// Tries the original PDF first (local file on this device, or the synced
// copy — see the GET handler in
// api/courses/[courseId]/documents/[documentId]/route.ts), falling back to
// the extracted text when neither is available (e.g. viewed from a device
// that never had the file, before PDF sync existed). When a PDF is
// available it's rendered by PdfViewer (PDF.js, not a native-plugin
// iframe) specifically so search-highlight and Explain-on-selection work
// against the real thing — see lib/scrollToHighlight.ts and PdfViewer.tsx.
export default function DocumentContent({
  document,
  highlight,
  onTidied,
  onHasPdfChange,
}: {
  document: ViewedDocument;
  highlight: string | null;
  // Called after "Make pretty" successfully rewrites a pasted document's
  // text — DocumentContent has no fetch of its own for document content, it
  // only renders what it's handed, so the caller needs to refetch.
  onTidied?: () => void;
  // Lets a caller with its own header (DocumentViewer's DialogDescription)
  // mirror the original-file-availability check without running a second
  // HEAD fetch. Named for its original pdf-only meaning; now true whenever
  // ANY original (pdf, docx, or a LibreOffice-converted odt/pptx) is
  // viewable, not just a pdf.
  onHasPdfChange?: (hasOriginal: boolean | null) => void;
}) {
  // Keyed by document id (not just a plain boolean) so a stale result from
  // the previous document can't flash while the new one is still loading —
  // compared against the current document at render time below, instead of
  // resetting state synchronously inside the effect.
  const [originalCheck, setOriginalCheck] = useState<{ documentId: number; hasOriginal: boolean } | null>(
    null
  );
  const [tidying, setTidying] = useState(false);
  // HTMLElement, not HTMLPreElement — the container is a <pre> for a real
  // PDF's plain extracted-text fallback, but a plain <div> for pasted text
  // rendered as Markdown (see the isPasted branch below); every consumer of
  // this ref (captureElementRegion, scrollToHighlight, AskAiPanel) already
  // takes a generic HTMLElement.
  const textRef = useRef<HTMLElement>(null);
  const isPasted = document.filePath === "";
  const ext = extensionOf(document.filename);
  const isDocx = ext === "docx";
  const isImage = isImageExtension(ext);

  // Screenshot-crop-to-ask for the extracted-text fallback view — same
  // html2canvas-based capture as notes (see items/[itemId]/page.tsx), useful
  // once this view can contain embedded images (see the paste-text image
  // support in courses/[courseId]/page.tsx).
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
    loading: cropLoading,
    answer: cropAnswer,
    error: cropError,
    dismiss: dismissCrop,
  } = useCropToAsk(
    `/api/courses/${document.courseId}/documents/${document.id}/ask`,
    (rect) => (textRef.current ? captureElementRegion(textRef.current, rect) : Promise.resolve(null))
  );

  async function handleTidy() {
    setTidying(true);
    try {
      const res = await fetch(
        `/api/courses/${document.courseId}/documents/${document.id}/tidy`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't tidy this text");
        return;
      }
      toast.success("Tidied up");
      onTidied?.();
    } catch {
      toast.error("Couldn't tidy this text");
    } finally {
      setTidying(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/courses/${document.courseId}/documents/${document.id}`, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setOriginalCheck({ documentId: document.id, hasOriginal: res.ok });
      })
      .catch(() => {
        if (!cancelled) setOriginalCheck({ documentId: document.id, hasOriginal: false });
      });
    return () => {
      cancelled = true;
    };
  }, [document.id, document.courseId]);

  const hasOriginal = originalCheck?.documentId === document.id ? originalCheck.hasOriginal : null;

  useEffect(() => {
    onHasPdfChange?.(hasOriginal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOriginal]);

  useEffect(() => {
    if (hasOriginal === false && highlight && textRef.current) {
      scrollToHighlight(textRef.current, highlight);
    }
    // Runs once per document as its text view first becomes visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id, hasOriginal]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
        {hasOriginal === null && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}
        {hasOriginal === true && isDocx && (
          <DocxViewer
            url={`/api/courses/${document.courseId}/documents/${document.id}`}
            filename={document.filename}
          />
        )}
        {hasOriginal === true && isImage && (
          <div className="relative h-full">
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              <CropToAskButton active={cropMode} onClick={toggleCropMode} />
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Download image"
                nativeButton={false}
                render={
                  <a
                    href={`/api/courses/${document.courseId}/documents/${document.id}`}
                    download={document.filename}
                  />
                }
              >
                <Download className="size-3.5" />
              </Button>
            </div>
            <div
              ref={textRef as React.RefObject<HTMLDivElement>}
              className={`h-full overflow-auto bg-muted/50 p-4 ${cropMode ? "cursor-crosshair select-none" : ""}`}
              onMouseDown={handleCropMouseDown}
              onMouseMove={handleCropMouseMove}
              onMouseUp={handleCropMouseUp}
            >
              <ImageViewer
                url={`/api/courses/${document.courseId}/documents/${document.id}`}
                filename={document.filename}
              />
            </div>
          </div>
        )}
        {hasOriginal === true && !isDocx && !isImage && (
          <PdfViewer
            url={`/api/courses/${document.courseId}/documents/${document.id}`}
            filename={document.filename}
            askEndpoint={`/api/courses/${document.courseId}/documents/${document.id}/ask`}
            highlight={highlight}
          />
        )}
        {hasOriginal === false &&
          (document.extracted_text ? (
            <div className="relative h-full">
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                <CropToAskButton active={cropMode} onClick={toggleCropMode} />
                {isPasted && (
                  <Button variant="outline" size="sm" onClick={handleTidy} disabled={tidying}>
                    <Wand2 className="size-3.5" />
                    {tidying ? "Tidying…" : "Make pretty"}
                  </Button>
                )}
              </div>
              {isPasted ? (
                <div
                  ref={textRef as React.RefObject<HTMLDivElement>}
                  className={`h-full overflow-y-auto p-4 ${cropMode ? "cursor-crosshair select-none" : ""}`}
                  onMouseDown={handleCropMouseDown}
                  onMouseMove={handleCropMouseMove}
                  onMouseUp={handleCropMouseUp}
                >
                  <PastedTextView text={document.extracted_text} markdown />
                </div>
              ) : (
                <pre
                  ref={textRef as React.RefObject<HTMLPreElement>}
                  className={`h-full overflow-y-auto p-4 font-sans text-sm whitespace-pre-wrap ${cropMode ? "cursor-crosshair select-none" : ""}`}
                  onMouseDown={handleCropMouseDown}
                  onMouseMove={handleCropMouseMove}
                  onMouseUp={handleCropMouseUp}
                >
                  <PastedTextView text={document.extracted_text} />
                </pre>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
              No preview available for this document.
            </div>
          ))}
      </div>
      <CropSelectionOverlay rect={cropRect} />
      {cropPending && (
        <CropPreviewCard
          dataUrl={cropPending}
          question={cropQuestion}
          onQuestionChange={setCropQuestion}
          onConfirm={confirmCropAsk}
          onCancel={cancelCropPending}
          loading={cropLoading}
        />
      )}
      {(cropLoading || cropAnswer || cropError) && (
        <AskAiAnswer
          loading={cropLoading}
          answer={cropAnswer}
          error={cropError}
          onDismiss={dismissCrop}
        />
      )}
      {hasOriginal === false && document.extracted_text && (
        <AskAiPanel
          endpoint={`/api/courses/${document.courseId}/documents/${document.id}/ask`}
          containerRef={textRef}
          kinds={["explain"]}
        />
      )}
    </>
  );
}
