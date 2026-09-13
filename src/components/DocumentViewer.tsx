"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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

// Tries the original PDF first (local file on this device, or the synced
// copy — see the GET handler in
// api/courses/[courseId]/documents/[documentId]/route.ts), falling back to
// the extracted text when neither is available (e.g. viewed from a device
// that never had the file, before PDF sync existed). When a PDF is
// available it's rendered by PdfViewer (PDF.js, not a native-plugin
// iframe) specifically so search-highlight and Explain-on-selection work
// against the real thing — see lib/scrollToHighlight.ts and PdfViewer.tsx.
export default function DocumentViewer({
  document,
  onOpenChange,
  onTidied,
}: {
  document: ViewedDocument | null;
  onOpenChange: (open: boolean) => void;
  // Called after "Make pretty" successfully rewrites a pasted document's
  // text — DocumentViewer has no fetch of its own for document content, it
  // only renders what it's handed, so the caller needs to refetch.
  onTidied?: () => void;
}) {
  // Keyed by document id (not just a plain boolean) so a stale result from
  // the previous document can't flash while the new one is still loading —
  // compared against the current document at render time below, instead of
  // resetting state synchronously inside the effect.
  const [pdfCheck, setPdfCheck] = useState<{ documentId: number; hasPdf: boolean } | null>(null);
  const [tidying, setTidying] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);
  const searchParams = useSearchParams();
  const highlight = searchParams.get("highlight");
  const isPasted = document?.filePath === "";

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
    document ? `/api/courses/${document.courseId}/documents/${document.id}/ask` : "",
    (rect) => (textRef.current ? captureElementRegion(textRef.current, rect) : Promise.resolve(null))
  );

  async function handleTidy() {
    if (!document) return;
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
    if (!document) return;
    let cancelled = false;
    fetch(`/api/courses/${document.courseId}/documents/${document.id}`, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setPdfCheck({ documentId: document.id, hasPdf: res.ok });
      })
      .catch(() => {
        if (!cancelled) setPdfCheck({ documentId: document.id, hasPdf: false });
      });
    return () => {
      cancelled = true;
    };
  }, [document]);

  const hasPdf = document && pdfCheck?.documentId === document.id ? pdfCheck.hasPdf : null;

  useEffect(() => {
    if (hasPdf === false && highlight && textRef.current) {
      scrollToHighlight(textRef.current, highlight);
    }
    // Runs once per document as its text view first becomes visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id, hasPdf]);

  return (
    <Dialog open={!!document} onOpenChange={onOpenChange}>
      {document && (
        <DialogContent className="flex h-[90vh] w-[95vw] flex-col sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle className="truncate">{document.filename}</DialogTitle>
            <DialogDescription>
              {hasPdf === false
                ? "The original PDF isn't available on this device — showing extracted text instead."
                : "Original PDF"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
            {hasPdf === null && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            )}
            {hasPdf === true && (
              <PdfViewer
                url={`/api/courses/${document.courseId}/documents/${document.id}`}
                filename={document.filename}
                askEndpoint={`/api/courses/${document.courseId}/documents/${document.id}/ask`}
                highlight={highlight}
              />
            )}
            {hasPdf === false &&
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
                  <pre
                    ref={textRef}
                    className={`h-full overflow-y-auto p-4 font-sans text-sm whitespace-pre-wrap ${cropMode ? "cursor-crosshair select-none" : ""}`}
                    onMouseDown={handleCropMouseDown}
                    onMouseMove={handleCropMouseMove}
                    onMouseUp={handleCropMouseUp}
                  >
                    <PastedTextView text={document.extracted_text} />
                  </pre>
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
          {hasPdf === false && document.extracted_text && (
            <AskAiPanel
              endpoint={`/api/courses/${document.courseId}/documents/${document.id}/ask`}
              containerRef={textRef}
              kinds={["explain"]}
            />
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
