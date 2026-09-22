"use client";

import { createContext, useContext } from "react";
import type { LinkTargets } from "@/lib/models";
import type { CanvasColor } from "@/lib/canvas";
import type { CanvasEdgeData, CanvasNodeData } from "@/lib/canvasFlow";

// What the custom node/edge components (rendered by React Flow, so outside
// CanvasBoard's own render tree as far as props go) need from the board:
// which card is in inline-edit mode, the link-target listing for resolving
// note/doc/item cards and [[links]], and the board's mutation entry points.
// Every callback here is stable across renders — only editingId and
// targets change — so cards don't all re-render on every drag frame.
export interface CanvasActions {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  targets: LinkTargets;
  // Patches a node's data. `commit` records an undo step and schedules an
  // autosave; leave it off for in-progress changes (e.g. every keystroke),
  // then commit once when the edit ends.
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>, commit?: boolean) => void;
  resizeNode: (id: string, size: { width?: number; height?: number }, commit?: boolean) => void;
  updateEdgeData: (id: string, patch: Partial<CanvasEdgeData>, commit?: boolean) => void;
  deleteEdge: (id: string) => void;
  navigate: (href: string) => void;
}

export const CanvasContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvasActions must be used inside a CanvasBoard");
  return ctx;
}

// A preset ("1"–"6") resolves to its themed token; a hex passes through.
export function canvasColorValue(color: CanvasColor | undefined): string | undefined {
  if (!color) return undefined;
  return /^[1-6]$/.test(color) ? `var(--canvas-${color})` : color;
}

export function cardAccentStyle(color: CanvasColor | undefined): React.CSSProperties | undefined {
  const value = canvasColorValue(color);
  return value ? ({ "--card-accent": value } as React.CSSProperties) : undefined;
}

export const CANVAS_COLOR_NAMES: Record<string, string> = {
  "1": "Red",
  "2": "Orange",
  "3": "Yellow",
  "4": "Green",
  "5": "Cyan",
  "6": "Purple",
};
