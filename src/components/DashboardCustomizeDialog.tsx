"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EyeOff, GripVertical, Plus } from "lucide-react";
import { cn } from "cn";
import type { HomeWidgetConfig, HomeWidgetId } from "@/lib/models";
import { HOME_WIDGET_META } from "@/lib/homeWidgetMeta";
import {
  GRID_COLS,
  MAX_ROW_SPAN,
  clampLayout,
  getGridMetrics,
  moveWidgetTo,
  pointToCell,
  resizeWidgetTo,
  setWidgetEnabled,
  tileGridStyle,
} from "@/lib/dashboardGrid";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface DragGhost {
  id: HomeWidgetId;
  // Pointer position minus the tile's own top-left, so the ghost tracks
  // under the same point of the tile the user actually grabbed.
  grabOffsetX: number;
  grabOffsetY: number;
  clientX: number;
  clientY: number;
  width: number;
  height: number;
}

function WidgetTile({
  widget,
  children,
  dimmed,
  onMoveStart,
  onResizeStart,
  onHide,
}: {
  widget: HomeWidgetConfig;
  children: ReactNode;
  dimmed: boolean;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onHide: () => void;
}) {
  const { label } = HOME_WIDGET_META[widget.id];
  return (
    <div className={cn("dashboard-tile relative h-full touch-none", dimmed && "opacity-40")} style={tileGridStyle(widget)}>
      <div className="pointer-events-none h-full [&_a]:pointer-events-none">{children}</div>
      <button
        type="button"
        onPointerDown={onMoveStart}
        aria-label={`Move ${label}`}
        className="absolute top-1.5 left-1.5 flex size-6 cursor-grab items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-80 backdrop-blur-sm hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onHide}
        aria-label={`Hide ${label}`}
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-80 backdrop-blur-sm hover:opacity-100"
      >
        <EyeOff className="size-3.5" />
      </button>
      <button
        type="button"
        onPointerDown={onResizeStart}
        aria-label={`Resize ${label}`}
        className="absolute bottom-1.5 right-1.5 flex size-6 cursor-nwse-resize items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-80 backdrop-blur-sm hover:opacity-100"
      >
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 2 2 10M10 6 6 10" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function HiddenChip({
  widget,
  onMoveStart,
  onShow,
}: {
  widget: HomeWidgetConfig;
  onMoveStart: (e: React.PointerEvent) => void;
  onShow: () => void;
}) {
  const { label, icon: Icon } = HOME_WIDGET_META[widget.id];
  return (
    <div
      onPointerDown={onMoveStart}
      className="flex cursor-grab touch-none items-center gap-1.5 rounded-md border border-dashed py-1.5 pr-1.5 pl-2.5 text-xs text-muted-foreground active:cursor-grabbing"
    >
      <Icon className="size-3.5" />
      {label}
      <button
        type="button"
        onClick={onShow}
        aria-label={`Show ${label}`}
        className="flex size-4 items-center justify-center rounded hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

export function DashboardCustomizeDialog({
  open,
  onOpenChange,
  widgets,
  onChange,
  renderContent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgets: HomeWidgetConfig[];
  onChange: (next: HomeWidgetConfig[]) => void;
  renderContent: (widget: HomeWidgetConfig) => ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [activeId, setActiveId] = useState<HomeWidgetId | null>(null);
  const [previewLayout, setPreviewLayout] = useState<HomeWidgetConfig | null>(null);

  const shown = widgets.filter((w) => w.enabled);
  const hidden = widgets.filter((w) => !w.enabled);

  function startMove(e: React.PointerEvent, widget: HomeWidgetConfig, tileRect: DOMRect | null) {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const { colStep, rowStep } = getGridMetrics(grid);
    const width = tileRect?.width ?? colStep * widget.colSpan;
    const height = tileRect?.height ?? rowStep * widget.rowSpan;

    setActiveId(widget.id);
    setGhost({
      id: widget.id,
      grabOffsetX: tileRect ? e.clientX - tileRect.left : width / 2,
      grabOffsetY: tileRect ? e.clientY - tileRect.top : height / 2,
      clientX: e.clientX,
      clientY: e.clientY,
      width,
      height,
    });
    setPreviewLayout(widget);

    function handleMove(ev: PointerEvent) {
      setGhost((prev) => (prev ? { ...prev, clientX: ev.clientX, clientY: ev.clientY } : prev));
      const gridEl = gridRef.current;
      if (!gridEl) return;
      const { col, row } = pointToCell(gridEl, ev.clientX, ev.clientY);
      setPreviewLayout({ ...widget, ...clampLayout({ col, row, colSpan: widget.colSpan, rowSpan: widget.rowSpan }) });
    }
    function handleUp(ev: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      const gridEl = gridRef.current;
      if (gridEl) {
        const { col, row } = pointToCell(gridEl, ev.clientX, ev.clientY);
        onChange(moveWidgetTo(widgets, widget.id, col, row));
      }
      setGhost(null);
      setActiveId(null);
      setPreviewLayout(null);
    }
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
  }

  function startResize(e: React.PointerEvent, widget: HomeWidgetConfig) {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const { colStep, rowStep } = getGridMetrics(grid);
    const startX = e.clientX;
    const startY = e.clientY;

    setActiveId(widget.id);
    setPreviewLayout(widget);

    function sizeFromDelta(ev: PointerEvent) {
      const deltaCols = Math.round((ev.clientX - startX) / colStep);
      const deltaRows = Math.round((ev.clientY - startY) / rowStep);
      const colSpan = Math.min(Math.max(1, widget.colSpan + deltaCols), GRID_COLS - widget.col);
      const rowSpan = Math.min(Math.max(1, widget.rowSpan + deltaRows), MAX_ROW_SPAN);
      return resizeWidgetTo(widgets, widget.id, colSpan, rowSpan).find((w) => w.id === widget.id) ?? widget;
    }
    function handleMove(ev: PointerEvent) {
      setPreviewLayout(sizeFromDelta(ev));
    }
    function handleUp(ev: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      const resized = sizeFromDelta(ev);
      onChange(widgets.map((w) => (w.id === widget.id ? resized : w)));
      setActiveId(null);
      setPreviewLayout(null);
    }
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
  }

  const ghostWidget = ghost ? widgets.find((w) => w.id === ghost.id) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Customize dashboard</DialogTitle>
          <DialogDescription>
            Drag the grip to move a widget anywhere on the grid, drag the corner to resize it, or
            drop it on Hidden to remove it.
          </DialogDescription>
        </DialogHeader>

        <div ref={gridRef} className="dashboard-grid relative min-h-[130px] rounded-xl bg-muted/30 p-2">
          {shown.length === 0 && !previewLayout && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              Nothing here — drag a widget up from Hidden.
            </p>
          )}
          {shown.map((widget) => (
            <WidgetTile
              key={widget.id}
              widget={widget}
              dimmed={activeId === widget.id}
              onMoveStart={(e) =>
                startMove(e, widget, (e.currentTarget as HTMLElement).closest<HTMLElement>(".dashboard-tile")?.getBoundingClientRect() ?? null)
              }
              onResizeStart={(e) => startResize(e, widget)}
              onHide={() => onChange(setWidgetEnabled(widgets, widget.id, false))}
            >
              {renderContent(widget)}
            </WidgetTile>
          ))}
          {previewLayout && (
            <div
              className="dashboard-tile pointer-events-none rounded-xl bg-focus/10 ring-2 ring-focus"
              style={tileGridStyle(previewLayout)}
            />
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Hidden</p>
          <div className="flex min-h-11 flex-wrap gap-2 rounded-xl border border-dashed p-2">
            {hidden.length === 0 && <p className="py-1 text-xs text-muted-foreground">Nothing hidden.</p>}
            {hidden.map((widget) => (
              <HiddenChip
                key={widget.id}
                widget={widget}
                onMoveStart={(e) => startMove(e, widget, null)}
                onShow={() => onChange(moveWidgetTo(widgets, widget.id, 0, 0))}
              />
            ))}
          </div>
        </div>
      </DialogContent>

      {ghost &&
        ghostWidget &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[70] opacity-70 [&_a]:pointer-events-none"
            style={{
              left: ghost.clientX - ghost.grabOffsetX,
              top: ghost.clientY - ghost.grabOffsetY,
              width: ghost.width,
              height: ghost.height,
            }}
          >
            {renderContent(ghostWidget)}
          </div>,
          document.body
        )}
    </Dialog>
  );
}
