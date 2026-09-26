import type { CanvasData, CanvasEdge, CanvasNode, CanvasSide } from "../canvas";

// Lays out a concept map as a JSON Canvas board: one group per chapter (in
// roadmap order, wrapping into rows), its concepts stacked inside, and the
// AI's labelled links between them. Nodes are coloured by current recall.
// Pure.

export interface MapGroup {
  label: string;
  concepts: { id: string; name: string; recall: number | null }[];
}

export interface MapLink {
  from: string;
  to: string;
  label: string;
}

const NODE = { width: 240, height: 64 };
const PAD = 30;
const GAP_X = 140;
const GAP_Y = 120;
const NODE_GAP = 24;
const COLUMNS = 4;
const HEADER = 40;

// JSON Canvas palette: 1 red, 3 yellow, 4 green, 5 cyan.
export function recallColor(recall: number | null): string | undefined {
  if (recall === null) return undefined;
  if (recall >= 0.85) return "4";
  if (recall >= 0.6) return "5";
  if (recall >= 0.3) return "3";
  return "1";
}

export function layoutConceptMap(groups: MapGroup[], links: MapLink[]): CanvasData {
  const nodes: CanvasNode[] = [];
  const where = new Map<string, { x: number; y: number; column: number; row: number }>();
  const groupWidth = NODE.width + PAD * 2;
  const heightOf = (g: MapGroup) => HEADER + PAD + g.concepts.length * (NODE.height + NODE_GAP) - NODE_GAP + PAD;

  let y = 0;
  for (let row = 0; row * COLUMNS < groups.length; row++) {
    const rowGroups = groups.slice(row * COLUMNS, row * COLUMNS + COLUMNS);
    const rowHeight = Math.max(...rowGroups.map(heightOf));
    rowGroups.forEach((group, column) => {
      const gx = column * (groupWidth + GAP_X);
      nodes.push({ id: `group-${row}-${column}`, type: "group", label: group.label, x: gx, y, width: groupWidth, height: heightOf(group) });
      group.concepts.forEach((c, i) => {
        const nx = gx + PAD;
        const ny = y + HEADER + PAD + i * (NODE.height + NODE_GAP);
        where.set(c.id, { x: nx, y: ny, column, row });
        const color = recallColor(c.recall);
        nodes.push({ id: c.id, type: "text", text: c.name, x: nx, y: ny, ...NODE, ...(color && { color }) });
      });
    });
    y += rowHeight + GAP_Y;
  }

  const edges: CanvasEdge[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const a = where.get(link.from);
    const b = where.get(link.to);
    const key = [link.from, link.to].sort().join("|");
    if (!a || !b || link.from === link.to || seen.has(key)) continue;
    seen.add(key);
    let fromSide: CanvasSide;
    let toSide: CanvasSide;
    if (a.row === b.row && a.column !== b.column) {
      [fromSide, toSide] = a.column < b.column ? ["right", "left"] : ["left", "right"];
    } else {
      [fromSide, toSide] = a.y <= b.y ? ["bottom", "top"] : ["top", "bottom"];
    }
    edges.push({ id: `edge-${edges.length + 1}`, fromNode: link.from, toNode: link.to, fromSide, toSide, toEnd: "arrow", label: link.label });
  }
  return { nodes, edges };
}
