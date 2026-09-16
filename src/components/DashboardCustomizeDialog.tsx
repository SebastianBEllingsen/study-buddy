"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EyeOff, GripVertical, Pencil, Plus } from "lucide-react";
import { cn } from "cn";
import type { HomeWidgetConfig, HomeWidgetId, HomeWidgetZone } from "@/lib/models";
import { HOME_WIDGET_META } from "@/lib/homeWidgetMeta";
import {
  GRID_COLS,
  MAX_ROW_SPAN,
  clampLayout,
  getGridMetrics,
  moveWidgetTo,
  pointToCell,
  resizeWidgetTo,
  resolveZoneAtPoint,
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

// A pencil button that swaps for an inline text field in place — e.g. the
// Assignments widget renamed to "Reading list" once it's just tracking
// whatever feed(s) it's pointed at, not literally assignments. Committing
// an empty/unchanged value clears the override (falls back to the widget's
// built-in default name) rather than saving a blank label.
function RenameButton({
  label,
  defaultLabel,
  onRename,
  className,
}: {
  label: string;
  defaultLabel: string;
  onRename: (next: string | null) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        placeholder={defaultLabel}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = draft.trim();
            onRename(trimmed && trimmed !== defaultLabel ? trimmed : null);
            setEditing(false);
          }
          if (e.key === "Escape") {
            setDraft(label);
            setEditing(false);
          }
        }}
        onBlur={() => {
          const trimmed = draft.trim();
          onRename(trimmed && trimmed !== defaultLabel ? trimmed : null);
          setEditing(false);
        }}
        className={cn(
          "h-6 w-28 rounded-md border bg-background px-1.5 text-xs shadow-sm focus:outline-none",
          className
        )}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setDraft(label);
        setEditing(true);
      }}
      aria-label={`Rename ${label}`}
      className={cn(
        "flex size-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-80 backdrop-blur-sm hover:opacity-100",
        className
      )}
    >
      <Pencil className="size-3.5" />
    </button>
  );
}

function WidgetTile({
  widget,
  children,
  dimmed,
  onMoveStart,
  onResizeStart,
  onHide,
  onRename,
}: {
  widget: HomeWidgetConfig;
  children: ReactNode;
  dimmed: boolean;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onHide: () => void;
  onRename: (label: string | null) => void;
}) {
  const { label: defaultLabel } = HOME_WIDGET_META[widget.id];
  const label = widget.label ?? defaultLabel;
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
      <RenameButton
        label={label}
        defaultLabel={defaultLabel}
        onRename={onRename}
        className="absolute bottom-1.5 left-1.5"
      />
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
  onRename,
}: {
  widget: HomeWidgetConfig;
  onMoveStart: (e: React.PointerEvent) => void;
  onShow: () => void;
  onRename: (label: string | null) => void;
}) {
  const { label: defaultLabel, icon: Icon } = HOME_WIDGET_META[widget.id];
  const label = widget.label ?? defaultLabel;
  return (
    <div
      onPointerDown={onMoveStart}
      className="flex cursor-grab touch-none items-center gap-1.5 rounded-md border border-dashed py-1.5 pr-1.5 pl-2.5 text-xs text-muted-foreground active:cursor-grabbing"
    >
      <Icon className="size-3.5" />
      {label}
      <RenameButton
        label={label}
        defaultLabel={defaultLabel}
        onRename={onRename}
        className="size-4 bg-transparent p-0 opacity-100 backdrop-blur-none hover:bg-muted hover:text-foreground"
      />
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

// One of the two independent grids (top-of-page / below-the-courses-list) —
// same tile rendering and drop-preview outline either way, just scoped to
// whichever zone's widgets it's handed.
function ZoneGrid({
  zone,
  gridRef,
  widgets,
  activeId,
  previewLayout,
  onMoveStart,
  onResizeStart,
  onHide,
  onRename,
  renderContent,
  emptyLabel,
}: {
  zone: HomeWidgetZone;
  gridRef: React.RefObject<HTMLDivElement | null>;
  widgets: HomeWidgetConfig[];
  activeId: HomeWidgetId | null;
  previewLayout: HomeWidgetConfig | null;
  onMoveStart: (e: React.PointerEvent, widget: HomeWidgetConfig) => void;
  onResizeStart: (e: React.PointerEvent, widget: HomeWidgetConfig) => void;
  onHide: (id: HomeWidgetId) => void;
  onRename: (id: HomeWidgetId, label: string | null) => void;
  renderContent: (widget: HomeWidgetConfig) => ReactNode;
  emptyLabel: string;
}) {
  const showPreviewHere = previewLayout?.zone === zone;
  return (
    <div ref={gridRef} className="dashboard-grid relative min-h-[130px] rounded-xl bg-muted/30 p-2">
      {widgets.length === 0 && !showPreviewHere && (
        <p className="col-span-full py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      )}
      {widgets.map((widget) => (
        <WidgetTile
          key={widget.id}
          widget={widget}
          dimmed={activeId === widget.id}
          onMoveStart={(e) => onMoveStart(e, widget)}
          onResizeStart={(e) => onResizeStart(e, widget)}
          onHide={() => onHide(widget.id)}
          onRename={(label) => onRename(widget.id, label)}
        >
          {renderContent(widget)}
        </WidgetTile>
      ))}
      {showPreviewHere && (
        <div
          className="dashboard-tile pointer-events-none rounded-xl bg-focus/10 ring-2 ring-focus"
          style={tileGridStyle(previewLayout)}
        />
      )}
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
  const topGridRef = useRef<HTMLDivElement>(null);
  const bottomGridRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [activeId, setActiveId] = useState<HomeWidgetId | null>(null);
  const [previewLayout, setPreviewLayout] = useState<HomeWidgetConfig | null>(null);

  const shownTop = widgets.filter((w) => w.enabled && w.zone === "top");
  const shownBottom = widgets.filter((w) => w.enabled && w.zone === "bottom");
  const hidden = widgets.filter((w) => !w.enabled);

  function gridRefFor(zone: HomeWidgetZone) {
    return zone === "top" ? topGridRef : bottomGridRef;
  }

  function startMove(e: React.PointerEvent, widget: HomeWidgetConfig, tileRect: DOMRect | null) {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const { colStep, rowStep } = getGridMetrics(gridRefFor(widget.zone).current ?? topGridRef.current!);
    const width = tileRect?.width ?? colStep * widget.colSpan;
    const height = tileRect?.height ?? rowStep * widget.rowSpan;

    // Which of the two grids the pointer is over is judged against each
    // zone's bounds as measured right now, before this drag's own preview
    // tile has rendered anywhere — not re-measured live on every
    // pointermove. A zone's box grows taller as soon as its preview tile
    // lands on a not-yet-visible row (CSS grid-auto-rows expands to fit
    // it), and re-querying getBoundingClientRect() on every move would let
    // that growth chase the pointer down the page: dragging a tile out of
    // the top zone toward the bottom one would just keep re-measuring an
    // ever-taller top zone that still contains the pointer, so it could
    // never register as having actually crossed into the bottom zone —
    // exactly the "drops just expand the zone above instead of moving
    // into the one below" bug this fixes. Falls back to the widget's own
    // zone when the pointer is over neither zone's original bounds (e.g.
    // in the gap between the two grids, or starting a drag from a Hidden
    // chip, which isn't inside any grid).
    const zoneRects: Record<HomeWidgetZone, DOMRect | null> = {
      top: topGridRef.current?.getBoundingClientRect() ?? null,
      bottom: bottomGridRef.current?.getBoundingClientRect() ?? null,
    };
    const zoneAtPoint = (x: number, y: number) => resolveZoneAtPoint(x, y, zoneRects, widget.zone);

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
      const zone = zoneAtPoint(ev.clientX, ev.clientY);
      const gridEl = gridRefFor(zone).current;
      if (!gridEl) return;
      const { col, row } = pointToCell(gridEl, ev.clientX, ev.clientY);
      setPreviewLayout({ ...widget, zone, ...clampLayout({ col, row, colSpan: widget.colSpan, rowSpan: widget.rowSpan }) });
    }
    function handleUp(ev: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      const zone = zoneAtPoint(ev.clientX, ev.clientY);
      const gridEl = gridRefFor(zone).current;
      if (gridEl) {
        const { col, row } = pointToCell(gridEl, ev.clientX, ev.clientY);
        onChange(moveWidgetTo(widgets, widget.id, col, row, zone));
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
    const grid = gridRefFor(widget.zone).current;
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

  function handleRename(id: HomeWidgetId, label: string | null) {
    onChange(widgets.map((w) => (w.id === id ? { ...w, label: label ?? undefined } : w)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Customize dashboard</DialogTitle>
          <DialogDescription>
            Drag the grip to move a widget anywhere on either grid — the one above your courses or
            the one below them — drag the corner to resize it, or drop it on Hidden to remove it.
          </DialogDescription>
        </DialogHeader>

        {/* Two grids plus the Hidden tray easily run taller than the
            viewport (especially with several widgets), so this scrolls in
            place — same fixed-header/scrolling-body split as
            EditFlashcardsDialog — instead of the dialog itself overflowing
            past the screen edge. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Above your courses</p>
            <ZoneGrid
              zone="top"
              gridRef={topGridRef}
              widgets={shownTop}
              activeId={activeId}
              previewLayout={previewLayout}
              onMoveStart={(e, widget) =>
                startMove(e, widget, (e.currentTarget as HTMLElement).closest<HTMLElement>(".dashboard-tile")?.getBoundingClientRect() ?? null)
              }
              onResizeStart={startResize}
              onHide={(id) => onChange(setWidgetEnabled(widgets, id, false))}
              onRename={handleRename}
              renderContent={renderContent}
              emptyLabel="Nothing here — drag a widget up from Hidden."
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Below your courses</p>
            <ZoneGrid
              zone="bottom"
              gridRef={bottomGridRef}
              widgets={shownBottom}
              activeId={activeId}
              previewLayout={previewLayout}
              onMoveStart={(e, widget) =>
                startMove(e, widget, (e.currentTarget as HTMLElement).closest<HTMLElement>(".dashboard-tile")?.getBoundingClientRect() ?? null)
              }
              onResizeStart={startResize}
              onHide={(id) => onChange(setWidgetEnabled(widgets, id, false))}
              onRename={handleRename}
              renderContent={renderContent}
              emptyLabel="Nothing here — drag a widget down from Hidden or from the grid above."
            />
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
                  onRename={(label) => handleRename(widget.id, label)}
                />
              ))}
            </div>
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
