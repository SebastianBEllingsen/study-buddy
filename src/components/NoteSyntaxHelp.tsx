"use client";

import { ExternalLink, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import NoteSyntaxGuide from "@/components/NoteSyntaxGuide";

// Same window name every time, so a second click focuses the already-open
// guide instead of stacking copies — the convention note/document detach use.
function detachGuide() {
  window.open("/help/note-syntax", "study-buddy-note-syntax", "noopener,width=560,height=900");
}

// The note header's (?) — the full syntax guide on hover, scrollable, with a
// button to pop it into its own window to keep beside the note. Same hover
// Tooltip as HelpTooltip, but triggered by a regular ghost icon button so
// it matches the header's other actions instead of HelpTooltip's small
// inline (?).
export default function NoteSyntaxHelp() {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Note syntax" />}>
        <HelpCircle className="size-3.5 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent className="max-h-[70vh] max-w-md overflow-y-auto p-3 text-left whitespace-normal">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">Note syntax</span>
          <button
            type="button"
            onClick={detachGuide}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 opacity-80 hover:bg-current/10 hover:opacity-100"
          >
            <ExternalLink className="size-3" />
            Detach
          </button>
        </div>
        <NoteSyntaxGuide />
      </TooltipContent>
    </Tooltip>
  );
}
