"use client";

import { prefersReducedMotion } from "@/lib/motion";

// Finds `text` inside `container`'s rendered DOM (not its React source —
// this walks actual text nodes, so it works the same whether the container
// is a <pre> of plain text or markdown/KaTeX output whose DOM doesn't
// necessarily mirror the raw source 1:1), wraps the first match in a
// <mark> that flashes and fades, and scrolls it into view. Returns whether
// a match was found. Best-effort: wrapped in try/catch since it directly
// mutates a DOM subtree React also renders into — a spurious re-render
// mid-flash could conflict with our inserted node, and this is a cosmetic
// nicety, not something worth letting crash the page over.
export function scrollToHighlight(container: HTMLElement, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length < 3) return false;

  try {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const raw = node.textContent ?? "";
      const idx = raw.toLowerCase().indexOf(needle);
      if (idx === -1) continue;

      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);

      const mark = document.createElement("mark");
      mark.className = "rounded-sm bg-amber/40 transition-colors duration-1000";
      range.surroundContents(mark);
      mark.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });

      setTimeout(() => {
        mark.classList.remove("bg-amber/40");
      }, 1200);
      // Unwrap once the fade finishes so a later React re-render of this
      // subtree isn't fighting a DOM node it doesn't know about.
      setTimeout(() => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      }, 2400);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
