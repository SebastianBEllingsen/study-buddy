"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "cn"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  // min-w-0: a grid/flex item (this is a direct child of DialogContent,
  // which is display:grid) defaults to min-width:auto — sized to fit its
  // content's own min-content width rather than shrinking to the space
  // it's given. A panel with a long, unbroken string somewhere inside (an
  // ICS feed URL, say) would otherwise force this whole tab set, and the
  // dialog around it, wider than intended — same reasoning as the min-w-0
  // already threaded through CalendarFeedsSection etc. below, just one
  // level higher now that they're nested inside this instead of sitting
  // directly under DialogContent.
  //
  // grid-rows-[auto_1fr]: TabsList sits in row 1; every TabsPanel below
  // (entering and exiting alike) is placed in row 2 / column 1 (see
  // TabsPanel's own row-start-2 col-start-1) so they overlay each other
  // instead of stacking one after another in normal flow. Without this, the
  // brief window where both the outgoing and incoming panel are mounted
  // together (see TabsPanel's fade below) adds their heights together,
  // which reads as a jarring jump/reflow rather than a smooth crossfade.
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("grid min-w-0 grid-cols-1 grid-rows-[auto_1fr] gap-3", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative col-start-1 row-start-1 flex shrink-0 gap-1 overflow-x-auto border-b text-sm",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "relative shrink-0 whitespace-nowrap px-2.5 py-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground data-selected:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute bottom-0 left-0 h-[2px] w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-primary transition-all duration-200",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      // A plain opacity swap with no transition at all (or one that snaps
      // straight to `display:none`, which the CSS *can't* animate) is what
      // reads as the new panel "popping" in — fading between
      // data-starting-style/data-ending-style (Base UI's own transition
      // hooks, held during enter/exit) instead gives it a duration to
      // actually run. keepMounted defaults to false, so once the exit
      // transition ends Base UI unmounts the panel itself — nothing here
      // needs to force it hidden the way an earlier version of this
      // component did (that's also what was leaving every panel visibly
      // stacked at once, since without a transition for Base UI to wait on,
      // it never got around to unmounting them).
      className={cn(
        "col-start-1 row-start-2 min-w-0 space-y-4 self-start outline-none transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 [&[inert]]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel }
