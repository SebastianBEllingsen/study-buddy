"use client";

import { Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Button } from "@/components/ui/button";
import { normalizeLatexDelimiters } from "@/lib/mathSanitizer";

export function AskAiAnswer({
  loading,
  answer,
  error,
  onDismiss,
}: {
  loading: boolean;
  answer: string | null;
  error: string | null;
  onDismiss: () => void;
}) {
  if (!loading && !answer && !error) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5" />
          AI
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
          <X className="size-3.5" />
        </Button>
      </div>
      {loading && <p className="text-muted-foreground">Thinking…</p>}
      {error && <p className="text-destructive">{error}</p>}
      {answer && (
        // Same rendering as the notes viewer (items/[itemId]/page.tsx) —
        // answers routinely include inline LaTeX (e.g. explaining a cropped
        // equation via screenshot-crop-to-ask), which plain text would show
        // as raw "$...$" instead of rendering.
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]}>
            {normalizeLatexDelimiters(answer)}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
