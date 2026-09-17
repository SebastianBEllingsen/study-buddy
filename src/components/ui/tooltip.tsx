"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "cn"

function TooltipProvider({
  delay = 200,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      delay={delay}
      data-slot="tooltip-provider"
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 8,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & TooltipPrimitive.Positioner.Props) {
  return (
    <TooltipPrimitive.Portal>
      {/* z-[60] belongs on the Positioner, not the Popup below — the Popup
          renders `position: static` (Base UI positions via the Positioner
          instead), so a z-index there is inert per the CSS spec (z-index
          only affects positioned elements). The Positioner IS `position:
          absolute` with `z-index: auto` by default, which loses to any
          explicit stacking context (e.g. a Dialog's `fixed ... z-50`)
          regardless of DOM order — confirmed by inspecting the live
          computed styles, not just assumed. Every Dialog/AlertDialog/
          Select/etc. overlay in this app tops out at z-50, so a tooltip
          triggered from inside one of those (e.g. Settings) needs a higher
          explicit z-index of its own to paint above it. */}
      <TooltipPrimitive.Positioner sideOffset={sideOffset} className="z-[60]" {...props}>
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
