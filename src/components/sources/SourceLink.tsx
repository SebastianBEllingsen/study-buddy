"use client";

import { FileText, NotebookPen } from "lucide-react";
import { cn } from "cn";
import type { SourceRef } from "@/lib/types";

export function sourceHref(source: SourceRef): string {
  return source.kind === "note" ? `/vault/${source.id}` : `/documents/${source.id}/view`;
}

// "Source: chapter-3.pdf" — opens the document or note a card/question came
// from in a new tab, so a running review or quiz isn't lost.
export function SourceLink({ source, className }: { source: SourceRef; className?: string }) {
  const Icon = source.kind === "note" ? NotebookPen : FileText;
  return (
    <a
      href={sourceHref(source)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline", className)}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">Source: {source.title}</span>
    </a>
  );
}
