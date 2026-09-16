"use client";

import { useEffect, useState } from "react";

export interface SelectionInfo {
  text: string;
  x: number;
  // Bottom edge of the selection — the toolbar anchors below it.
  y: number;
}

// One shared document-level "selectionchange" listener for every
// useTextSelection instance on the page, instead of one per instance.
// QuizRunner renders every question's QuestionCard (and thus every
// AskAiPanel/useTextSelection) at once rather than paginated, so a large
// quiz previously meant one native listener — and one redundant
// window.getSelection()/toString() call — per question, all firing on
// every selection change anywhere on the page. window.getSelection() and
// the selected text are now computed once per event here and handed to
// every subscriber; each still does its own (cheap) container.contains()
// check, since only it knows whether the selection is inside its container.
const listeners = new Set<(sel: Selection | null, text: string) => void>();
let unsubscribeFromDocument: (() => void) | null = null;

function ensureDocumentListener() {
  if (unsubscribeFromDocument) return;
  function handleSelectionChange() {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    for (const listener of listeners) listener(sel, text);
  }
  document.addEventListener("selectionchange", handleSelectionChange);
  unsubscribeFromDocument = () => {
    document.removeEventListener("selectionchange", handleSelectionChange);
    unsubscribeFromDocument = null;
  };
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
    function handleSelectionChange(sel: Selection | null, text: string) {
      const container = containerRef.current;
      if (!sel || sel.isCollapsed || !container || !text || !sel.anchorNode || !container.contains(sel.anchorNode)) {
        setSelection(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelection({ text, x: rect.left + rect.width / 2, y: rect.bottom });
    }

    listeners.add(handleSelectionChange);
    ensureDocumentListener();
    return () => {
      listeners.delete(handleSelectionChange);
      if (listeners.size === 0 && unsubscribeFromDocument) unsubscribeFromDocument();
    };
  }, [containerRef]);

  function clear() {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return { selection, clear };
}
