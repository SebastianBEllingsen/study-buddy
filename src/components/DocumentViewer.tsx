"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import DocumentContent, { type ViewedDocument } from "@/components/DocumentContent";

export type { ViewedDocument };

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
  const [hasPdf, setHasPdf] = useState<boolean | null>(null);
  const searchParams = useSearchParams();
  const highlight = searchParams.get("highlight");

  // Pops the exact same viewer (PdfViewer, Crop & Ask, highlight-to-explain
  // — see DocumentContent) into its own browser window at
  // app/documents/[documentId]/view, e.g. so it can sit next to the app
  // while taking notes elsewhere. Closes this dialog rather than leaving
  // both open — the content has moved, not duplicated.
  function handleDetach() {
    if (!document) return;
    const url = highlight
      ? `/documents/${document.id}/view?highlight=${encodeURIComponent(highlight)}`
      : `/documents/${document.id}/view`;
    window.open(url, `study-buddy-document-${document.id}`, "noopener,width=900,height=1000");
    onOpenChange(false);
  }

  return (
    <Dialog open={!!document} onOpenChange={onOpenChange}>
      {document && (
        <DialogContent
          showCloseButton={false}
          className="flex h-[90vh] w-[95vw] flex-col sm:max-w-6xl"
        >
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="truncate">{document.filename}</DialogTitle>
                <DialogDescription>
                  {hasPdf === false
                    ? "The original PDF isn't available on this device — showing extracted text instead."
                    : "Original PDF"}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="outline" size="sm" onClick={handleDetach}>
                  <ExternalLink className="size-3.5" />
                  Detach
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          </DialogHeader>
          <DocumentContent
            document={document}
            highlight={highlight}
            onTidied={onTidied}
            onHasPdfChange={setHasPdf}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
