"use client";

import { memo, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Minus, Pencil, Trash2 } from "lucide-react";
import type { CanvasEnd } from "@/lib/canvas";
import type { CanvasFlowEdge } from "@/lib/canvasFlow";
import { canvasColorValue, useCanvasActions } from "./CanvasContext";
import { ColorPicker, ToolbarButton, ToolbarShell } from "./CanvasToolbarParts";

// The four arrowhead layouts, in the order the direction button cycles
// through them — Obsidian's own "line direction" menu.
const DIRECTIONS: { fromEnd: CanvasEnd; toEnd: CanvasEnd; label: string; icon: typeof ArrowRight }[] = [
  { fromEnd: "none", toEnd: "arrow", label: "Arrow at end", icon: ArrowRight },
  { fromEnd: "arrow", toEnd: "arrow", label: "Arrows at both ends", icon: ArrowLeftRight },
  { fromEnd: "arrow", toEnd: "none", label: "Arrow at start", icon: ArrowLeft },
  { fromEnd: "none", toEnd: "none", label: "No arrows", icon: Minus },
];

function EdgeLabelEditor({ id, initial }: { id: string; initial: string }) {
  const { setEditingId, updateEdgeData } = useCanvasActions();
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      size={Math.max(8, value.length + 1)}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        updateEdgeData(id, { label: value.trim() }, true);
        setEditingId(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className="canvas-edge-label nodrag nopan outline-none ring-2 ring-ring"
      placeholder="Label"
    />
  );
}

export const CanvasEdge = memo(function CanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerStart,
  markerEnd,
}: EdgeProps<CanvasFlowEdge>) {
  const { editingId, setEditingId, updateEdgeData, deleteEdge } = useCanvasActions();
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const editing = editingId === id;
  const label = data?.label ?? "";
  const stroke = canvasColorValue(data?.color) ?? "var(--canvas-edge)";
  const directionIndex = DIRECTIONS.findIndex(
    (d) => d.fromEnd === (data?.fromEnd ?? "none") && d.toEnd === (data?.toEnd ?? "arrow")
  );
  const direction = DIRECTIONS[Math.max(0, directionIndex)];
  const nextDirection = DIRECTIONS[(Math.max(0, directionIndex) + 1) % DIRECTIONS.length];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={24}
        style={{ stroke, strokeWidth: 2 }}
      />
      <EdgeLabelRenderer>
        <div
          className="absolute"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {editing ? (
            <EdgeLabelEditor id={id} initial={label} />
          ) : (
            label && (
              <div
                className="canvas-edge-label nopan"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(id);
                }}
              >
                {label}
              </div>
            )
          )}
          {selected && !editing && (
            <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2" style={{ pointerEvents: "all" }}>
              <ToolbarShell>
                <ColorPicker value={data?.color} onChange={(color) => updateEdgeData(id, { color }, true)} />
                <ToolbarButton
                  label={`Direction: ${direction.label.toLowerCase()} — click for ${nextDirection.label.toLowerCase()}`}
                  onClick={() =>
                    updateEdgeData(id, { fromEnd: nextDirection.fromEnd, toEnd: nextDirection.toEnd }, true)
                  }
                >
                  <direction.icon />
                </ToolbarButton>
                <ToolbarButton label={label ? "Edit label" : "Add label"} onClick={() => setEditingId(id)}>
                  <Pencil />
                </ToolbarButton>
                <ToolbarButton label="Delete connection" onClick={() => deleteEdge(id)}>
                  <Trash2 />
                </ToolbarButton>
              </ToolbarShell>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

export const canvasEdgeTypes = { canvas: CanvasEdge };
