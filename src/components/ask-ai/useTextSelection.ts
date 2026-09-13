"use client";

import { useEffect, useState } from "react";

export interface SelectionInfo {
  text: string;
  x: number;
  // Bottom edge of the selection — the toolbar anchors below it.
  y: number;
}

/**
 * Tracks the current text selection, but only while it falls inside the
 * given container — lets multiple instances (one per question card, per
 * flashcard, etc.) coexist without stepping on each other. Coordinates are
 * viewport-relative (from getBoundingClientRect), meant for a `fixed`
 * positioned toolbar.
 */
export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      const container = containerRef.current;
      if (!sel || sel.isCollapsed || !container) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text || !sel.anchorNode || !container.contains(sel.anchorNode)) {
        setSelection(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelection({ text, x: rect.left + rect.width / 2, y: rect.bottom });
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [containerRef]);

  function clear() {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return { selection, clear };
}
