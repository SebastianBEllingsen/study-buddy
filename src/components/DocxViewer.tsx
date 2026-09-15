"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// Renders a real .docx file client-side via docx-preview — no LibreOffice
// or server-side conversion involved, unlike odt/pptx (see
// lib/libreoffice.ts), which have no equivalent pure-JS renderer and go
// through the shared PdfViewer instead once converted. docx-preview turns
// the document straight into styled HTML (paragraphs, tables, images) and
// injects it (plus the styles it needs) into `containerRef`.
export default function DocxViewer({ url, filename }: { url: string; filename: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // No separate "loading" state set synchronously at the top of the effect
  // (that trips this codebase's react-hooks/set-state-in-effect lint rule —
  // see PdfViewer's own `pages`/`error` pair for the same pattern):
  // "loading" is instead derived below from neither of these being set yet.
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [{ renderAsync }, res] = await Promise.all([import("docx-preview"), fetch(url)]);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = "";
      await renderAsync(blob, container, container, {
        inWrapper: true,
        ignoreLastRenderedPageBreak: false,
      });
      if (!cancelled) setRendered(true);
    })().catch(() => {
      if (!cancelled) setError("Couldn't render this document.");
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const loading = !rendered && !error;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b bg-muted/30 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Download document"
          nativeButton={false}
          render={<a href={url} download={filename} />}
        >
          <Download className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/50 p-4">
        {loading && <p className="text-center text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-center text-sm text-muted-foreground">{error}</p>}
        <div ref={containerRef} className={`docx-viewer-body mx-auto ${loading || error ? "hidden" : ""}`} />
      </div>
    </div>
  );
}
