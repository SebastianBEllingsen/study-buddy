"use client";

import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "cn";

// A small (?) affordance for "nice to know" detail that doesn't need to sit
// inline as a permanent paragraph — settings toggles, dialog field captions,
// etc. Reuses the existing hover+focus Tooltip primitive; this just supplies
// the standard icon trigger so every spot that wants this pattern looks the
// same, instead of each callsite composing Tooltip/TooltipTrigger/
// TooltipContent from scratch.
//
// stopPropagation on click matters here specifically: most Settings toggles
// are a <label> wrapping both the text and the checkbox, relying on native
// label-click-toggles-checkbox behavior — without this, clicking the (?)
// icon would also flip the checkbox underneath it.
export function HelpTooltip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="More info"
            className="inline-flex shrink-0 items-center text-muted-foreground/50 hover:text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <HelpCircle className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className={cn("max-w-xs text-left whitespace-normal", className)}>
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
