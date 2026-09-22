import type { Edge, Node } from "@xyflow/react";
import type {
  CanvasColor,
  CanvasData,
  CanvasEdge,
  CanvasEnd,
  CanvasNode,
  CanvasSide,
} from "@/lib/canvas";
import { CANVAS_SIDES, facingSides } from "@/lib/canvas";

// Translation between the stored JSON Canvas document (lib/canvas.ts) and
// React Flow's own node/edge model, which is what CanvasWorkspace actually
// renders and edits. Kept pure and separate from the component so the
// round-trip (the thing autosave depends on never silently dropping a
// field) is unit-testable without a DOM.

export type CanvasNodeData = Record<string, unknown> & {
  color?: CanvasColor;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
};

export type CanvasFlowNode = Node<CanvasNodeData, CanvasNode["type"]>;

export type CanvasEdgeData = Record<string, unknown> & {
  color?: CanvasColor;
  label?: string;
  fromEnd: CanvasEnd;
  toEnd: CanvasEnd;
};

export type CanvasFlowEdge = Edge<CanvasEdgeData, "canvas">;

// Groups always sit underneath everything else (their translucent fill is
// meant to read as a backdrop to the cards inside them), regardless of
// which was created or selected last.
export const GROUP_Z_INDEX = 0;
export const CARD_Z_INDEX = 1;

// Every node renders one handle per side, each id'd by its side name —
// that's what lets fromSide/toSide round-trip as sourceHandle/targetHandle.
function sideFromHandle(handle: string | null | undefined): CanvasSide | undefined {
  return handle && (CANVAS_SIDES as string[]).includes(handle) ? (handle as CanvasSide) : undefined;
}

export function nodeToFlow(node: CanvasNode): CanvasFlowNode {
  const data: CanvasNodeData = {};
  if (node.color) data.color = node.color;
  if (node.type === "text") data.text = node.text;
  if (node.type === "file") {
    data.file = node.file;
    if (node.subpath) data.subpath = node.subpath;
  }
  if (node.type === "link") data.url = node.url;
  if (node.type === "group" && node.label !== undefined) data.label = node.label;
  return {
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    zIndex: node.type === "group" ? GROUP_Z_INDEX : CARD_Z_INDEX,
    data,
  };
}

// `nodesById` lets an edge stored without sides attach to the sides its
// cards face each other on (see facingSides), instead of React Flow's
// default of the first handle. Those sides are then written back on the
// next save, pinning the arrow where it was first drawn.
export function edgeToFlow(edge: CanvasEdge, nodesById?: Map<string, CanvasNode>): CanvasFlowEdge {
  const data: CanvasEdgeData = {
    fromEnd: edge.fromEnd ?? "none",
    toEnd: edge.toEnd ?? "arrow",
  };
  if (edge.color) data.color = edge.color;
  if (edge.label) data.label = edge.label;
  const from = nodesById?.get(edge.fromNode);
  const to = nodesById?.get(edge.toNode);
  const auto = (!edge.fromSide || !edge.toSide) && from && to ? facingSides(from, to) : null;
  return {
    id: edge.id,
    type: "canvas",
    source: edge.fromNode,
    target: edge.toNode,
    sourceHandle: edge.fromSide ?? auto?.fromSide ?? null,
    targetHandle: edge.toSide ?? auto?.toSide ?? null,
    data,
  };
}

export function canvasToFlow(data: CanvasData): { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] } {
  // Groups first — among equal zIndex React Flow paints in array order, and
  // this also keeps nested groups painting beneath their contents.
  const ordered = [...data.nodes.filter((n) => n.type === "group"), ...data.nodes.filter((n) => n.type !== "group")];
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  return { nodes: ordered.map(nodeToFlow), edges: data.edges.map((e) => edgeToFlow(e, nodesById)) };
}

function nodeFromFlow(node: CanvasFlowNode): CanvasNode | null {
  // width/height are what the resizer and our own creation code set;
  // measured is React Flow's fallback reading of the DOM before either has.
  const width = Math.round(node.width ?? node.measured?.width ?? 0);
  const height = Math.round(node.height ?? node.measured?.height ?? 0);
  const base = {
    id: node.id,
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    width,
    height,
    ...(node.data.color ? { color: node.data.color } : {}),
  };
  switch (node.type) {
    case "text":
      return { ...base, type: "text", text: node.data.text ?? "" };
    case "file":
      if (!node.data.file) return null;
      return { ...base, type: "file", file: node.data.file, ...(node.data.subpath ? { subpath: node.data.subpath } : {}) };
    case "link":
      return { ...base, type: "link", url: node.data.url ?? "" };
    case "group":
      return { ...base, type: "group", ...(node.data.label !== undefined ? { label: node.data.label } : {}) };
    default:
      return null;
  }
}

function edgeFromFlow(edge: CanvasFlowEdge): CanvasEdge {
  const out: CanvasEdge = { id: edge.id, fromNode: edge.source, toNode: edge.target };
  const fromSide = sideFromHandle(edge.sourceHandle);
  const toSide = sideFromHandle(edge.targetHandle);
  if (fromSide) out.fromSide = fromSide;
  if (toSide) out.toSide = toSide;
  // Only written when it differs from the JSON Canvas default, which keeps
  // files tidy and identical to what Obsidian itself would write.
  const fromEnd = edge.data?.fromEnd ?? "none";
  const toEnd = edge.data?.toEnd ?? "arrow";
  if (fromEnd !== "none") out.fromEnd = fromEnd;
  if (toEnd !== "arrow") out.toEnd = toEnd;
  if (edge.data?.color) out.color = edge.data.color;
  if (edge.data?.label) out.label = edge.data.label;
  return out;
}

export function flowToCanvas(nodes: CanvasFlowNode[], edges: CanvasFlowEdge[]): CanvasData {
  const outNodes = nodes.map(nodeFromFlow).filter((n): n is CanvasNode => n !== null);
  const ids = new Set(outNodes.map((n) => n.id));
  return {
    nodes: outNodes,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(edgeFromFlow),
  };
}
