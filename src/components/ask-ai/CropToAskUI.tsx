"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Crop, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { normalizeLatexDelimiters } from "@/lib/mathSanitizer";
import type { AskTurn, CropRect } from "./useCropToAsk";

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

// Replaces AskAiAnswer once a crop's first answer comes back — the cropped
// image stays visible and "live" for as long as this thread is open, with
// every question/answer pair shown in order and a standing input at the
// bottom for the next follow-up. Dismissing drops the whole thread and the
// image (see useCropToAsk's dismiss), back to no crop in progress; there's
// no separate "close just this answer" — the thread is the unit, same as a
// chat.
export function CropAskThread({
  image,
  turns,
  loading,
  error,
  question,
  onQuestionChange,
  onAskFollowUp,
  onDismiss,
}: {
  image: string;
  turns: AskTurn[];
  loading: boolean;
  error: string | null;
  question: string;
  onQuestionChange: (value: string) => void;
  onAskFollowUp: () => void;
  onDismiss: () => void;
}) {
  // Scrolls to the newest turn (or the "Thinking…" placeholder while one's
  // in flight) — same pattern as ChatContent's own message list, since an
  // unbounded number of follow-ups needs to stay usable rather than growing
  // the panel (and everything below it) without limit.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5" />
          AI
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
          <X className="size-3.5" />
        </Button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not a next/image-optimizable asset */}
      <img
        src={image}
        alt="Cropped selection"
        className="max-h-28 rounded-md border border-border object-contain"
      />
      <div ref={scrollRef} className="max-h-72 space-y-3 overflow-y-auto">
        {turns.map((turn, i) => (
          <div key={i} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{turn.question}</p>
            {/* Same rendering as AskAiAnswer — answers routinely include
                inline LaTeX (e.g. explaining a cropped equation). */}
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {normalizeLatexDelimiters(turn.answer)}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && <p className="text-muted-foreground">Thinking…</p>}
        {error && <p className="text-destructive">{error}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          placeholder="Ask a follow-up…"
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAskFollowUp();
            }
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          onClick={onAskFollowUp}
          disabled={loading || !question.trim()}
          aria-label="Ask follow-up"
        >
          <ArrowUp className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
