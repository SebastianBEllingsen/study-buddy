import type { CSSProperties } from "react";
import type { HomeWidgetConfig, HomeWidgetId } from "./models";

// Android-style home-screen widget grid: a fixed number of columns, widgets
// occupy a rectangle of cells and can be placed/resized freely (see
// DashboardCustomizeDialog.tsx for the drag/resize interactions). Shared
// between that editor and the read-only render on the home page itself so
// both always agree on the same cell math.
//
// 6 columns (not 4) so a widget can be a sixth, a third, a half, two-thirds,
// or the full row — real sizing options, not just "small or full".
export const GRID_COLS = 6;
export const MAX_ROW_SPAN = 3;
// Fixed row height (not `auto`) so dragging/resizing can convert a pointer
// delta in pixels into a whole number of grid rows — must match
// `grid-auto-rows` on `.dashboard-grid` in globals.css.
export const ROW_HEIGHT_PX = 120;

// Reads the grid's actual column width and gap from the live layout, rather
// than assuming a value — pointer math built from an assumed gap of 0
// drifts further off the real cell boundaries the more columns a drag
// crosses, which is what made drops feel "a little off": the whole grid
// uses a 1rem gap (globals.css), and a container's `1fr` columns divide up
// (width - gaps), not the raw width.
export function getGridMetrics(gridEl: HTMLElement) {
  const rect = gridEl.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(gridEl).columnGap || "0") || 0;
  const colWidth = (rect.width - gap * (GRID_COLS - 1)) / GRID_COLS;
  return { rect, gap, colStep: colWidth + gap, rowStep: ROW_HEIGHT_PX + gap };
}

// Converts a viewport point into a grid cell using those real metrics.
export function pointToCell(gridEl: HTMLElement, clientX: number, clientY: number) {
  const { rect, colStep, rowStep } = getGridMetrics(gridEl);
  const col = Math.floor((clientX - rect.left) / colStep);
  const row = Math.floor((clientY - rect.top) / rowStep);
  return { col, row };
}

export function clampLayout(w: Pick<HomeWidgetConfig, "col" | "row" | "colSpan" | "rowSpan">) {
  const colSpan = Math.min(Math.max(1, w.colSpan), GRID_COLS);
  const rowSpan = Math.min(Math.max(1, w.rowSpan), MAX_ROW_SPAN);
  const col = Math.min(Math.max(0, w.col), GRID_COLS - colSpan);
  const row = Math.max(0, w.row);
  return { col, row, colSpan, rowSpan };
}

export function boxesOverlap(
  a: Pick<HomeWidgetConfig, "col" | "row" | "colSpan" | "rowSpan">,
  b: Pick<HomeWidgetConfig, "col" | "row" | "colSpan" | "rowSpan">
): boolean {
  const aRight = a.col + a.colSpan;
  const aBottom = a.row + a.rowSpan;
  const bRight = b.col + b.colSpan;
  const bBottom = b.row + b.rowSpan;
  return a.col < bRight && aRight > b.col && a.row < bBottom && aBottom > b.row;
}

// CSS custom properties consumed by the `.dashboard-tile` rule in
// globals.css — mobile ignores them (single-column stack); the desktop
// media query there positions the tile on the real grid.
export function tileGridStyle(w: Pick<HomeWidgetConfig, "col" | "row" | "colSpan" | "rowSpan">): CSSProperties {
  return {
    "--tile-col": w.col + 1,
    "--tile-row": w.row + 1,
    "--tile-span-col": w.colSpan,
    "--tile-span-row": w.rowSpan,
  } as CSSProperties;
}

// Shrinks colSpan and/or rowSpan until the box no longer overlaps any of
// `others` — used both while live-resizing (so the preview never visually
// overlaps a neighbor) and to sanity-check a computed drop size.
//
// Tries each axis independently before touching both: a resize that grows
// straight down into a neighbor below should just cap the height, not also
// destroy the width trying (uselessly) to squeeze past a widget it was
// never overlapping horizontally. Shrinking the "wrong" axis first can't
// resolve an overlap that's purely on the other axis, so a naive
// column-then-row (or row-then-column) walk can grind a dimension down to
// 1 for nothing before ever trying the axis that actually mattered.
export function clampSpanAgainstNeighbors(
  others: Pick<HomeWidgetConfig, "col" | "row" | "colSpan" | "rowSpan">[],
  box: { col: number; row: number; colSpan: number; rowSpan: number }
): { colSpan: number; rowSpan: number } {
  const targetColSpan = Math.min(Math.max(1, box.colSpan), GRID_COLS - box.col);
  const targetRowSpan = Math.min(Math.max(1, box.rowSpan), MAX_ROW_SPAN);
  const overlapsAt = (cs: number, rs: number) =>
    others.some((o) => boxesOverlap({ col: box.col, row: box.row, colSpan: cs, rowSpan: rs }, o));

  if (!overlapsAt(targetColSpan, targetRowSpan)) return { colSpan: targetColSpan, rowSpan: targetRowSpan };

  // Row axis alone, holding the full target width.
  let rowSpan = targetRowSpan;
  while (rowSpan > 1 && overlapsAt(targetColSpan, rowSpan)) rowSpan--;
  if (!overlapsAt(targetColSpan, rowSpan)) return { colSpan: targetColSpan, rowSpan };

  // Row alone didn't clear it — the column axis is also (or instead)
  // responsible, so shrink it too, holding rowSpan at what row-shrinking
  // already settled on.
  let colSpan = targetColSpan;
  while (colSpan > 1 && overlapsAt(colSpan, rowSpan)) colSpan--;
  return { colSpan, rowSpan };
}

// Moves `id` so its top-left corner is at (col, row), keeping its own size.
// If that lands on top of another enabled widget IN THE SAME ZONE, they
// swap places (the occupant takes the mover's old spot and old zone) rather
// than the drop being rejected — the same "always succeeds, never just
// refuses" feel as Android's widget grid. Passing `zone` (e.g. dragging a
// tile from the top grid into the bottom one in the customize dialog)
// reassigns the widget there; omitting it keeps its current zone, so every
// existing call site that never mentions zones is unaffected.
export function moveWidgetTo(
  widgets: HomeWidgetConfig[],
  id: HomeWidgetId,
  col: number,
  row: number,
  zone?: HomeWidgetConfig["zone"]
): HomeWidgetConfig[] {
  const moving = widgets.find((w) => w.id === id);
  if (!moving) return widgets;
  const targetZone = zone ?? moving.zone;
  const layout = clampLayout({ col, row, colSpan: moving.colSpan, rowSpan: moving.rowSpan });
  const target: HomeWidgetConfig = { ...moving, ...layout, zone: targetZone, enabled: true };
  const collision = widgets.find((w) => w.id !== id && w.enabled && w.zone === targetZone && boxesOverlap(target, w));
  return widgets.map((w) => {
    if (w.id === id) return target;
    if (collision && w.id === collision.id) return { ...w, col: moving.col, row: moving.row, zone: moving.zone };
    return w;
  });
}

// Resizes `id` in place, shrinking as needed so it never overlaps another
// enabled widget in the same zone.
export function resizeWidgetTo(
  widgets: HomeWidgetConfig[],
  id: HomeWidgetId,
  colSpan: number,
  rowSpan: number
): HomeWidgetConfig[] {
  const target = widgets.find((w) => w.id === id);
  if (!target) return widgets;
  const others = widgets.filter((w) => w.id !== id && w.enabled && w.zone === target.zone);
  const clamped = clampSpanAgainstNeighbors(others, { col: target.col, row: target.row, colSpan, rowSpan });
  return widgets.map((w) => (w.id === id ? { ...w, ...clamped } : w));
}

export function setWidgetEnabled(
  widgets: HomeWidgetConfig[],
  id: HomeWidgetId,
  enabled: boolean
): HomeWidgetConfig[] {
  return widgets.map((w) => (w.id === id ? { ...w, enabled } : w));
}
