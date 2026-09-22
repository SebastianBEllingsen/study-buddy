"use client";

import { Ban, Palette } from "lucide-react";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CANVAS_PRESET_COLORS, type CanvasColor } from "@/lib/canvas";
import { CANVAS_COLOR_NAMES, canvasColorValue } from "./CanvasContext";

// The small floating pill every canvas toolbar shares — the selection
// toolbar above a card, the one above a selected arrow, the zoom/undo rail,
// and the add-card dock — so they read as one family of controls.
export function ToolbarShell({
  children,
  orientation = "horizontal",
  className,
}: {
  children: React.ReactNode;
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-orientation={orientation}
      className={cn(
        "nodrag nopan flex items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md",
        orientation === "vertical" && "flex-col",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarDivider({ orientation = "horizontal" }: { orientation?: "horizontal" | "vertical" }) {
  return <div className={orientation === "vertical" ? "my-0.5 h-px w-5 bg-border" : "mx-0.5 h-5 w-px bg-border"} />;
}

type ToolbarButtonProps = {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function ToolbarButton({
  label,
  shortcut,
  side = "top",
  active,
  disabled,
  className,
  children,
  ...rest
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
              active && "bg-muted text-foreground",
              className
            )}
            {...rest}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: CanvasColor | undefined;
  onChange: (color: CanvasColor | undefined) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Set color"
            title="Set color"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4"
          />
        }
      >
        {value ? (
          <span className="size-4 rounded-full ring-1 ring-foreground/20" style={{ background: canvasColorValue(value) }} />
        ) : (
          <Palette />
        )}
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="nodrag nopan w-auto p-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="No color"
            title="No color"
            onClick={() => onChange(undefined)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted",
              !value && "ring-2 ring-ring"
            )}
          >
            <Ban className="size-4" />
          </button>
          {CANVAS_PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={CANVAS_COLOR_NAMES[color]}
              title={CANVAS_COLOR_NAMES[color]}
              onClick={() => onChange(color)}
              className={cn(
                "size-7 rounded-full ring-offset-2 ring-offset-popover transition-transform hover:scale-110",
                value === color && "ring-2 ring-ring"
              )}
              style={{ background: canvasColorValue(color) }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
