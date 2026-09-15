"use client";

import { createPortal } from "react-dom";
import { Crop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAiEnabled } from "@/lib/useAiEnabled";
import type { CropRect } from "./useCropToAsk";

// Toggle button for entering/leaving crop-to-ask mode — shared styling
// across every content view that offers it (PdfViewer, notes, the
// extracted-text document view).
export function CropToAskButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  // Same single gating point as AskAiButtons/AskAiToolbar — see
  // useAiEnabled's doc comment.
  if (!useAiEnabled()) return null;
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon-sm"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "Cancel crop to ask" : "Crop a region to ask AI about it"}
    >
      <Crop className="size-3.5" />
    </Button>
  );
}

// The live selection rectangle while dragging — tracks viewport (client)
// coordinates, so it's rendered through a portal straight into <body>
// rather than as a plain `position: fixed` element in place. A `fixed`
// element nested inside an ancestor with a CSS transform (e.g. Dialog's
// centering `-translate-x-1/2 -translate-y-1/2`) is positioned relative to
// THAT ancestor, not the real viewport, per the CSS spec's containing-block
// rules — which is what made the box visibly drift from the cursor inside
// any dialog (PdfViewer, the document extracted-text view). Escaping to
// `document.body` via a portal sidesteps the whole issue.
export function CropSelectionOverlay({ rect }: { rect: CropRect | null }) {
  if (!rect || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[60] border-2 border-primary bg-primary/10"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />,
    document.body
  );
}

// Shown after a crop is captured, before it's sent — lets the student see
// exactly what was selected and optionally type a specific question about
// it instead of always sending a generic "explain this".
export function CropPreviewCard({
  dataUrl,
  question,
  onQuestionChange,
  onConfirm,
  onCancel,
  loading,
}: {
  dataUrl: string;
  question: string;
  onQuestionChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not a next/image-optimizable asset */}
      <img
        src={dataUrl}
        alt="Cropped selection"
        className="max-h-40 rounded-md border border-border object-contain"
      />
      <Input
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
        placeholder="Ask something about this (optional)"
        disabled={loading}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onConfirm();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onConfirm} disabled={loading}>
          {loading ? "Asking…" : "Ask"}
        </Button>
      </div>
    </div>
  );
}
