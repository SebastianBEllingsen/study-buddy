import { describe, it, expect } from "vitest";
import {
  appendBelow,
  GRID_COLS,
  MAX_ROW_SPAN,
  clampLayout,
  boxesOverlap,
  moveWidgetTo,
  resizeWidgetTo,
  pointInRect,
  resolveZoneAtPoint,
} from "./dashboardGrid";
import type { HomeWidgetConfig } from "./models";

function widget(overrides: Partial<HomeWidgetConfig> & Pick<HomeWidgetConfig, "id">): HomeWidgetConfig {
  return {
    enabled: true,
    zone: "top",
    col: 0,
    row: 0,
    colSpan: 1,
    rowSpan: 1,
    ...overrides,
  };
}

describe("clampLayout", () => {
  it("leaves an already-valid layout unchanged", () => {
    expect(clampLayout({ col: 1, row: 2, colSpan: 2, rowSpan: 2 })).toEqual({
      col: 1,
      row: 2,
      colSpan: 2,
      rowSpan: 2,
    });
  });

  it("clamps colSpan/rowSpan to their max, and col so the box stays on the grid", () => {
    expect(clampLayout({ col: 5, row: 0, colSpan: 100, rowSpan: 100 })).toEqual({
      col: 0,
      row: 0,
      colSpan: GRID_COLS,
      rowSpan: MAX_ROW_SPAN,
    });
  });

  it("never lets col or row go negative", () => {
    expect(clampLayout({ col: -3, row: -1, colSpan: 1, rowSpan: 1 })).toEqual({
      col: 0,
      row: 0,
      colSpan: 1,
      rowSpan: 1,
    });
  });
});

describe("boxesOverlap", () => {
  it("detects a real overlap", () => {
    const a = { col: 0, row: 0, colSpan: 2, rowSpan: 2 };
    const b = { col: 1, row: 1, colSpan: 2, rowSpan: 2 };
    expect(boxesOverlap(a, b)).toBe(true);
  });

  it("treats adjacent (touching-edge) boxes as not overlapping", () => {
    const a = { col: 0, row: 0, colSpan: 2, rowSpan: 1 };
    const b = { col: 2, row: 0, colSpan: 2, rowSpan: 1 };
    expect(boxesOverlap(a, b)).toBe(false);
  });

  it("detects boxes with no shared rows or columns as not overlapping", () => {
    const a = { col: 0, row: 0, colSpan: 1, rowSpan: 1 };
    const b = { col: 5, row: 2, colSpan: 1, rowSpan: 1 };
    expect(boxesOverlap(a, b)).toBe(false);
  });
});

describe("moveWidgetTo", () => {
  it("moves a widget to the given cell within its current zone", () => {
    const widgets = [widget({ id: "streak", col: 0, row: 0 })];
    const result = moveWidgetTo(widgets, "streak", 3, 1);
    expect(result.find((w) => w.id === "streak")).toMatchObject({ col: 3, row: 1, zone: "top" });
  });

  it("reassigns the widget's zone when one is passed", () => {
    const widgets = [widget({ id: "streak", zone: "top" })];
    const result = moveWidgetTo(widgets, "streak", 0, 0, "bottom");
    expect(result.find((w) => w.id === "streak")?.zone).toBe("bottom");
  });

  it("swaps places with a colliding widget in the same zone", () => {
    const widgets = [
      widget({ id: "streak", col: 0, row: 0, zone: "top" }),
      widget({ id: "due", col: 2, row: 0, zone: "top" }),
    ];
    const result = moveWidgetTo(widgets, "streak", 2, 0, "top");
    expect(result.find((w) => w.id === "streak")).toMatchObject({ col: 2, row: 0 });
    // The occupant is bumped back to the mover's old spot, not just erased.
    expect(result.find((w) => w.id === "due")).toMatchObject({ col: 0, row: 0 });
  });

  it("does not collide with a widget in a different zone", () => {
    const widgets = [
      widget({ id: "streak", col: 0, row: 0, zone: "top" }),
      widget({ id: "due", col: 2, row: 0, zone: "bottom" }),
    ];
    const result = moveWidgetTo(widgets, "streak", 2, 0, "top");
    expect(result.find((w) => w.id === "streak")).toMatchObject({ col: 2, row: 0, zone: "top" });
    expect(result.find((w) => w.id === "due")).toMatchObject({ col: 2, row: 0, zone: "bottom" });
  });

  it("is a no-op for an id that doesn't exist", () => {
    const widgets = [widget({ id: "streak" })];
    expect(moveWidgetTo(widgets, "due", 1, 1)).toBe(widgets);
  });
});

describe("moveWidgetTo with widgets of different sizes", () => {
  const inGrid = (w: HomeWidgetConfig) => w.col >= 0 && w.col + w.colSpan <= GRID_COLS && w.rowSpan <= MAX_ROW_SPAN;
  const noOverlap = (ws: HomeWidgetConfig[]) =>
    ws.every((a, i) => ws.slice(i + 1).every((b) => !(a.enabled && b.enabled && a.zone === b.zone && boxesOverlap(a, b))));

  it("swaps a narrow widget with a wide one without the wide one leaving the grid", () => {
    // The narrow one sits on the right edge; the wide one can't take its old spot at full width.
    const widgets = [
      widget({ id: "streak", col: 5, row: 3, colSpan: 1 }),
      widget({ id: "due", col: 3, row: 0, colSpan: 3, rowSpan: 2 }),
    ];
    const result = moveWidgetTo(widgets, "streak", 4, 1);
    expect(result.every(inGrid)).toBe(true);
    expect(noOverlap(result)).toBe(true);
    expect(result.find((w) => w.id === "due")).toMatchObject({ colSpan: 3, rowSpan: 2 });
  });

  it("moves every widget a big one lands on, not just the first", () => {
    const widgets = [
      widget({ id: "streak", col: 0, row: 5, colSpan: 4 }),
      widget({ id: "due", col: 0, row: 0 }),
      widget({ id: "heatmap", col: 1, row: 0 }),
      widget({ id: "recent", col: 2, row: 0 }),
    ];
    const result = moveWidgetTo(widgets, "streak", 0, 0);
    expect(noOverlap(result)).toBe(true);
    expect(result.every(inGrid)).toBe(true);
    expect(result.find((w) => w.id === "streak")).toMatchObject({ col: 0, row: 0, colSpan: 4 });
  });

  it("puts a widget bumped by a cross-zone drag into the zone the mover left", () => {
    const widgets = [
      widget({ id: "streak", col: 0, row: 0, zone: "top" }),
      widget({ id: "due", col: 0, row: 0, zone: "bottom", colSpan: 2 }),
    ];
    const result = moveWidgetTo(widgets, "streak", 0, 0, "bottom");
    expect(result.find((w) => w.id === "streak")).toMatchObject({ zone: "bottom", col: 0, row: 0 });
    expect(result.find((w) => w.id === "due")).toMatchObject({ zone: "top", colSpan: 2 });
    expect(noOverlap(result)).toBe(true);
  });

  it("never overlaps or leaves the grid, whatever is dragged where", () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    for (let n = 0; n < 1500; n++) {
      // A valid starting layout: no overlaps, everything inside the grid.
      const ws: HomeWidgetConfig[] = [];
      for (let i = 0; i < int(2, 7); i++) {
        for (let tries = 0; tries < 30; tries++) {
          const colSpan = int(1, 4);
          const w = widget({ id: `w${i}` as never, colSpan, rowSpan: int(1, 2), col: int(0, GRID_COLS - colSpan), row: int(0, 5), zone: rnd() < 0.3 ? "bottom" : "top" });
          if (!ws.some((o) => o.zone === w.zone && boxesOverlap(w, o))) {
            ws.push(w);
            break;
          }
        }
      }
      const mover = ws[int(0, ws.length - 1)];
      const result = moveWidgetTo(ws, mover.id, int(0, GRID_COLS - 1), int(0, 6), rnd() < 0.5 ? mover.zone : rnd() < 0.5 ? "top" : "bottom");
      expect(result.every(inGrid)).toBe(true);
      expect(noOverlap(result)).toBe(true);
      expect(result.map((w) => [w.id, w.colSpan, w.rowSpan])).toEqual(ws.map((w) => [w.id, w.colSpan, w.rowSpan]));
    }
  });
});

describe("resizeWidgetTo", () => {
  it("resizes freely when nothing is in the way", () => {
    const widgets = [widget({ id: "streak", col: 0, row: 0, colSpan: 1, rowSpan: 1 })];
    const result = resizeWidgetTo(widgets, "streak", 3, 2);
    expect(result.find((w) => w.id === "streak")).toMatchObject({ colSpan: 3, rowSpan: 2 });
  });

  it("shrinks to avoid overlapping a neighbor in the same zone", () => {
    const widgets = [
      widget({ id: "streak", col: 0, row: 0, colSpan: 1, rowSpan: 1 }),
      widget({ id: "due", col: 2, row: 0, colSpan: 1, rowSpan: 1 }),
    ];
    const result = resizeWidgetTo(widgets, "streak", 4, 1);
    const resized = result.find((w) => w.id === "streak")!;
    // Exact value, not just "shrunk some" — a resize that refuses to grow
    // at all (colSpan staying 1) would satisfy both a "< 4" check and the
    // no-overlap check just as well. "due" occupies col 2 alone, so the
    // widest streak can get without reaching it is colSpan 2 (cols 0-1).
    expect(resized.colSpan).toBe(2);
    expect(boxesOverlap(resized, result.find((w) => w.id === "due")!)).toBe(false);
  });

  it("ignores a same-position widget in a different zone", () => {
    const widgets = [
      widget({ id: "streak", col: 0, row: 0, colSpan: 1, rowSpan: 1, zone: "top" }),
      widget({ id: "due", col: 1, row: 0, colSpan: 1, rowSpan: 1, zone: "bottom" }),
    ];
    const result = resizeWidgetTo(widgets, "streak", 3, 1);
    expect(result.find((w) => w.id === "streak")).toMatchObject({ colSpan: 3, rowSpan: 1 });
  });
});

describe("pointInRect", () => {
  const rect = { left: 10, right: 110, top: 20, bottom: 120 };

  it("accepts a point inside the rect, including its edges", () => {
    expect(pointInRect(50, 50, rect)).toBe(true);
    expect(pointInRect(10, 20, rect)).toBe(true);
    expect(pointInRect(110, 120, rect)).toBe(true);
  });

  it("rejects a point outside the rect", () => {
    expect(pointInRect(9, 50, rect)).toBe(false);
    expect(pointInRect(111, 50, rect)).toBe(false);
    expect(pointInRect(50, 19, rect)).toBe(false);
    expect(pointInRect(50, 121, rect)).toBe(false);
  });
});

describe("resolveZoneAtPoint", () => {
  const topRect = { left: 0, right: 100, top: 0, bottom: 100 };
  const bottomRect = { left: 0, right: 100, top: 200, bottom: 300 };

  it("picks the top zone when the point is inside its rect", () => {
    expect(resolveZoneAtPoint(50, 50, { top: topRect, bottom: bottomRect }, "top")).toBe("top");
  });

  it("picks the bottom zone when the point is inside its rect", () => {
    expect(resolveZoneAtPoint(50, 250, { top: topRect, bottom: bottomRect }, "top")).toBe("bottom");
  });

  it("falls back when the point is in the gap between the two zones", () => {
    expect(resolveZoneAtPoint(50, 150, { top: topRect, bottom: bottomRect }, "top")).toBe("top");
    expect(resolveZoneAtPoint(50, 150, { top: topRect, bottom: bottomRect }, "bottom")).toBe("bottom");
  });

  it("falls back when a zone's rect is missing (not yet mounted)", () => {
    expect(resolveZoneAtPoint(50, 250, { top: topRect, bottom: null }, "top")).toBe("top");
  });

  // NOT a regression test for the reported drag bug, despite an earlier
  // version of this file claiming to be one — see the note below. This only
  // confirms resolveZoneAtPoint is a plain pure function of whatever rects
  // it's given: same rects in, same zone out, regardless of how many times
  // it's called with them. That's necessary but not sufficient for the fix.
  it("is a pure function of its rect inputs — calling it repeatedly with the same rects doesn't change the result", () => {
    const rects = { top: topRect, bottom: bottomRect };
    expect(resolveZoneAtPoint(50, 220, rects, "top")).toBe("bottom");
    expect(resolveZoneAtPoint(50, 220, rects, "top")).toBe("bottom");
  });

  // The actual reported bug ("a widget placed above Courses, dragged down
  // toward below Courses, just expands the zone above instead of moving
  // into the one below") lived in DashboardCustomizeDialog.tsx's startMove:
  // it re-measured topGridRef/bottomGridRef's getBoundingClientRect() on
  // every pointermove rather than once at drag start, so a preview tile
  // rendered inside the still-"top"-zoned drag inflated the top zone's
  // rendered height (CSS grid-auto-rows expanding to fit it) enough to keep
  // "containing" the pointer no matter how far down it moved — the fix
  // (see that file's own comment on startMove) is capturing zoneRects once,
  // before any state change, and reusing that frozen snapshot for the whole
  // drag. resolveZoneAtPoint itself was never the bug (it's exercised above
  // as a pure function), and there is no automated test of the actual fix:
  // that would mean driving a real pointerdown/pointermove/pointerup
  // sequence against the rendered dialog with a mocked/growing
  // getBoundingClientRect and asserting startMove's rects snapshot is
  // captured once — this repo has no harness for a component-level,
  // pointer-event-driven interaction like that (the existing
  // @testing-library/react usage elsewhere is limited to renderHook on pure
  // hooks, not a full rendered dialog with Radix internals and pointer
  // capture). Per this repo's testing policy, that gap is being said
  // explicitly rather than left implied by a mislabeled pure-function test.
});

describe("appendBelow", () => {
  const w = (id: HomeWidgetConfig["id"], zone: HomeWidgetConfig["zone"], row: number, rowSpan: number, enabled = true): HomeWidgetConfig => ({
    id,
    enabled,
    zone,
    col: 2,
    row,
    colSpan: 3,
    rowSpan,
  });

  it("puts a new widget on the first free row of its zone, at column 0", () => {
    const out = appendBelow([w("streak", "top", 0, 1), w("recent", "top", 1, 2), w("due", "bottom", 0, 3)], [w("pomodoro", "top", 0, 2)]);
    expect(out.find((x) => x.id === "pomodoro")).toMatchObject({ col: 0, row: 3, zone: "top", rowSpan: 2 });
  });

  it("ignores hidden widgets and other zones", () => {
    const out = appendBelow([w("streak", "top", 5, 1, false), w("due", "bottom", 0, 3)], [w("pomodoro", "top", 4, 2)]);
    expect(out.find((x) => x.id === "pomodoro")).toMatchObject({ col: 0, row: 0 });
  });

  it("stacks several added widgets below each other", () => {
    const out = appendBelow([w("streak", "top", 0, 1)], [w("recent", "top", 0, 2), w("pomodoro", "top", 0, 2)]);
    expect(out.map((x) => [x.id, x.row])).toEqual([
      ["streak", 0],
      ["recent", 1],
      ["pomodoro", 3],
    ]);
  });
});
