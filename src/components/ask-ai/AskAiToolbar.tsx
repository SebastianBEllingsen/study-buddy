"use client";

import { createPortal } from "react-dom";
import { Lightbulb, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAiEnabled } from "@/lib/useAiEnabled";
import type { AskKind } from "./useAskAi";
import type { SelectionInfo } from "./useTextSelection";

export function AskAiToolbar({
  position,
  onAsk,
  kinds = ["hint", "explain"],
}: {
  position: SelectionInfo;
  onAsk: (kind: AskKind) => void;
  // Which buttons to show — e.g. document viewer selections only make
  // sense to "explain" (there's no quiz question to hint toward).
  kinds?: AskKind[];
}) {
  // Same single gating point as AskAiButtons — see useAiEnabled's doc comment.
  if (!useAiEnabled()) return null;
  // Portaled to <body> rather than rendered in place: `position: fixed`
  // only resolves against the actual viewport when every ancestor is
  // transform-free — the document viewer's Dialog centers itself with a
  // CSS transform, which per spec makes it the containing block for any
  // `position: fixed` descendant instead. Left in place, this toolbar's
  // viewport-relative coordinates (from getBoundingClientRect in
  // useTextSelection) would be resolved against the dialog's own box,
  // landing it far from the actual selection. Portaling sidesteps the
  // dialog entirely, so the same coordinates work whether this renders
  // inside a Dialog or a plain page.
  return createPortal(
    <div
      className="fixed z-50 flex translate-y-2 -translate-x-1/2 gap-1 rounded-lg border bg-popover p-1 shadow-md"
      style={{ left: position.x, top: position.y }}
      // Selecting text unfocuses the page; without this the mousedown on
      // the toolbar itself would collapse the selection before onClick fires.
      onMouseDown={(e) => e.preventDefault()}
    >
      {kinds.includes("hint") && (
        <Button size="xs" variant="ghost" onClick={() => onAsk("hint")}>
          <Lightbulb className="size-3" />
          Hint
        </Button>
      )}
      {kinds.includes("explain") && (
        <Button size="xs" variant="ghost" onClick={() => onAsk("explain")}>
          <MessageCircleQuestion className="size-3" />
          Explain
        </Button>
      )}
    </div>,
    document.body
  );
}
