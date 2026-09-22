import { parseNoteLinks } from "@/lib/noteLinks";

// The data model behind a canvas (see the canvases table in schema.sql) —
// JSON Canvas 1.0 (https://jsoncanvas.org), Obsidian's own open .canvas
// format, kept verbatim so a board can round-trip to/from Obsidian and so a
// future "generate a canvas from this PDF" feature only has to have an AI
// emit plain, well-documented JSON.
//
// The one app-specific convention: a "file" node's `file` is a reference
// into this app rather than a vault path — "note:12", "doc:7", "item:3", or
// "image:5" (an uploaded_images row, same id a note's studybuddy-image:<id>
// embed uses). `subpath` carries an optional "#snippet" deep-link anchor for
// a document/item, the same role [[doc:7#snippet]] plays in a note.

export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEnd = "none" | "arrow";
// "1"–"6" are JSON Canvas's preset palette (red, orange, yellow, green,
// cyan, purple), mapped to --canvas-1…6 in globals.css. A "#rrggbb" hex is
// also valid per the spec and is passed through untouched.
export type CanvasColor = string;

interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text";
  text: string;
}

export interface CanvasFileNode extends CanvasNodeBase {
  type: "file";
  file: string;
  subpath?: string;
}

export interface CanvasLinkNode extends CanvasNodeBase {
  type: "link";
  url: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group";
  label?: string;
}

export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toNode: string;
  toSide?: CanvasSide;
  toEnd?: CanvasEnd;
  color?: CanvasColor;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const CANVAS_SIDES: CanvasSide[] = ["top", "right", "bottom", "left"];
export const CANVAS_PRESET_COLORS = ["1", "2", "3", "4", "5", "6"] as const;
export const EMPTY_CANVAS_JSON = '{"nodes":[],"edges":[]}';

// Obsidian's own defaults for a freshly created card/group.
export const DEFAULT_TEXT_NODE_SIZE = { width: 250, height: 60 };
export const DEFAULT_FILE_NODE_SIZE = { width: 400, height: 400 };
export const DEFAULT_GROUP_SIZE = { width: 500, height: 400 };
export const MIN_NODE_SIZE = { width: 80, height: 40 };

export function emptyCanvas(): CanvasData {
  return { nodes: [], edges: [] };
}

// Obsidian writes 16 lowercase hex chars per node/edge id; matching that
// keeps exported files indistinguishable from ones Obsidian made itself.
export function generateCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- File references ---

export type CanvasFileRefType = "note" | "doc" | "item" | "image";

export interface CanvasFileRef {
  type: CanvasFileRefType;
  id: number;
}

const FILE_REF_RE = /^(note|doc|item|image):(\d+)$/;

export function parseFileRef(file: string): CanvasFileRef | null {
  const match = FILE_REF_RE.exec(file);
  if (!match) return null;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) && id > 0 ? { type: match[1] as CanvasFileRefType, id } : null;
}

export function buildFileRef(ref: CanvasFileRef): string {
  return `${ref.type}:${ref.id}`;
}

// --- Parsing / validation ---

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSide(value: unknown): value is CanvasSide {
  return typeof value === "string" && (CANVAS_SIDES as string[]).includes(value);
}

function isEnd(value: unknown): value is CanvasEnd {
  return value === "none" || value === "arrow";
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidCanvasColor(value: unknown): value is CanvasColor {
  return (
    typeof value === "string" &&
    ((CANVAS_PRESET_COLORS as readonly string[]).includes(value) || HEX_COLOR_RE.test(value))
  );
}

function sanitizeNode(raw: unknown): CanvasNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (![r.x, r.y, r.width, r.height].every(isFiniteNumber)) return null;
  const base: CanvasNodeBase = {
    id: r.id,
    x: r.x as number,
    y: r.y as number,
    width: Math.max(MIN_NODE_SIZE.width, r.width as number),
    height: Math.max(MIN_NODE_SIZE.height, r.height as number),
  };
  if (isValidCanvasColor(r.color)) base.color = r.color;

  switch (r.type) {
    case "text":
      return { ...base, type: "text", text: typeof r.text === "string" ? r.text : "" };
    case "file": {
      if (typeof r.file !== "string") return null;
      const node: CanvasFileNode = { ...base, type: "file", file: r.file };
      if (typeof r.subpath === "string" && r.subpath) node.subpath = r.subpath;
      return node;
    }
    case "link":
      return typeof r.url === "string" ? { ...base, type: "link", url: r.url } : null;
    case "group": {
      const node: CanvasGroupNode = { ...base, type: "group" };
      if (typeof r.label === "string") node.label = r.label;
      return node;
    }
    default:
      return null;
  }
}

function sanitizeEdge(raw: unknown, nodeIds: Set<string>): CanvasEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.fromNode !== "string" || typeof r.toNode !== "string") return null;
  // An edge whose endpoint no longer exists has nothing to draw between —
  // dropped rather than rejected, same leniency as an unknown node type.
  if (!nodeIds.has(r.fromNode) || !nodeIds.has(r.toNode)) return null;
  const edge: CanvasEdge = { id: r.id, fromNode: r.fromNode, toNode: r.toNode };
  if (isSide(r.fromSide)) edge.fromSide = r.fromSide;
  if (isSide(r.toSide)) edge.toSide = r.toSide;
  if (isEnd(r.fromEnd)) edge.fromEnd = r.fromEnd;
  if (isEnd(r.toEnd)) edge.toEnd = r.toEnd;
  if (isValidCanvasColor(r.color)) edge.color = r.color;
  if (typeof r.label === "string" && r.label) edge.label = r.label;
  return edge;
}

// Lenient by design: anything malformed (an unknown node type, a missing
// coordinate, an edge to a deleted node, a duplicate id) is dropped rather
// than failing the whole board — one bad entry, e.g. from a hand-edited or
// imported .canvas file, shouldn't make every other card unreachable.
// Returns null only when the top-level shape isn't a canvas at all.
export function sanitizeCanvasData(value: unknown): CanvasData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const rawNodes = v.nodes === undefined ? [] : v.nodes;
  const rawEdges = v.edges === undefined ? [] : v.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;

  const nodes: CanvasNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of rawNodes) {
    const node = sanitizeNode(raw);
    if (!node || nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  const edges: CanvasEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of rawEdges) {
    const edge = sanitizeEdge(raw, nodeIds);
    if (!edge || edgeIds.has(edge.id)) continue;
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  return { nodes, edges };
}

// For reading a stored row back — a corrupted `data` column degrades to an
// empty board rather than a crash (same spirit as the content_json
// resilience in models.ts).
export function parseCanvasJson(json: string): CanvasData {
  try {
    return sanitizeCanvasData(JSON.parse(json)) ?? emptyCanvas();
  } catch {
    return emptyCanvas();
  }
}

// --- .canvas files ---

// Tab-indented, same as Obsidian writes its own .canvas files.
export function serializeCanvas(data: CanvasData): string {
  return JSON.stringify(data, null, "\t");
}

// Keeps the title recognizable while dropping characters that aren't safe
// in a filename on some OS (Windows is the strictest).
export function canvasFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
  return `${safe || "Untitled canvas"}.canvas`;
}

export function canvasTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.(canvas|json)$/i, "").trim() || "Imported canvas";
}

// For an uploaded file — null when it isn't JSON or isn't shaped like a
// canvas at all. Individual bad entries inside a real canvas are dropped,
// not rejected (see sanitizeCanvasData).
export function parseCanvasFile(text: string): CanvasData | null {
  try {
    return sanitizeCanvasData(JSON.parse(text));
  } catch {
    return null;
  }
}

// --- References (backlinks, image-deletion guard) ---

// Every note/doc/item/image this canvas points at — both as a whole card
// ("file" nodes) and inline inside a text card's markdown ([[note:12]]
// links and studybuddy-image:<id> embeds, same syntax a note uses).
export function canvasReferences(data: CanvasData): CanvasFileRef[] {
  const refs: CanvasFileRef[] = [];
  const seen = new Set<string>();
  const add = (ref: CanvasFileRef) => {
    const key = buildFileRef(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const node of data.nodes) {
    if (node.type === "file") {
      const ref = parseFileRef(node.file);
      if (ref) add(ref);
    } else if (node.type === "text") {
      for (const link of parseNoteLinks(node.text)) add({ type: link.type, id: link.id });
      for (const match of node.text.matchAll(/studybuddy-image:(\d+)/g)) {
        add({ type: "image", id: Number(match[1]) });
      }
    }
  }
  return refs;
}

export function canvasReferencesTarget(data: CanvasData, target: CanvasFileRef): boolean {
  return canvasReferences(data).some((ref) => ref.type === target.type && ref.id === target.id);
}

// --- Geometry ---

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// Obsidian decides group membership geometrically at drag time rather than
// storing a parent pointer (JSON Canvas has no such field): whatever sits
// fully inside a group's bounds when you start dragging it moves along.
export function nodesInsideGroup(group: Rect & { id: string }, nodes: (Rect & { id: string })[]): string[] {
  return nodes.filter((n) => n.id !== group.id && rectContains(group, n)).map((n) => n.id);
}

// Which side of a card a point is closest to — used when a dragged-out
// connection is dropped onto a card's body rather than exactly onto one of
// its handles, so the arrow still attaches where you'd expect.
export function nearestSide(rect: Rect, point: { x: number; y: number }): CanvasSide {
  const distance: Record<CanvasSide, number> = {
    top: Math.abs(point.y - rect.y),
    right: Math.abs(rect.x + rect.width - point.x),
    bottom: Math.abs(rect.y + rect.height - point.y),
    left: Math.abs(point.x - rect.x),
  };
  return CANVAS_SIDES.reduce((best, side) => (distance[side] < distance[best] ? side : best));
}

// The sides two cards face each other on — for an edge stored without
// fromSide/toSide (optional in JSON Canvas, and common in hand-written or
// imported files), which Obsidian draws between the facing sides.
export function facingSides(from: Rect, to: Rect): { fromSide: CanvasSide; toSide: CanvasSide } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}

export function oppositeSide(side: CanvasSide): CanvasSide {
  return side === "top" ? "bottom" : side === "bottom" ? "top" : side === "left" ? "right" : "left";
}

// Where to put a card created by dropping a dragged-out connection onto
// empty space: centered on the drop point along the axis the connection
// arrives on, with the matching edge of the card touching the point — so
// the new arrow lands on the new card's near side, like Obsidian does.
export function placeNodeAtDrop(
  drop: { x: number; y: number },
  size: { width: number; height: number },
  fromSide: CanvasSide
): { x: number; y: number; side: CanvasSide } {
  const side = oppositeSide(fromSide);
  switch (side) {
    case "left":
      return { x: drop.x, y: drop.y - size.height / 2, side };
    case "right":
      return { x: drop.x - size.width, y: drop.y - size.height / 2, side };
    case "top":
      return { x: drop.x - size.width / 2, y: drop.y, side };
    case "bottom":
      return { x: drop.x - size.width / 2, y: drop.y - size.height, side };
  }
}

export function snapToGrid(value: number, grid = 20): number {
  return Math.round(value / grid) * grid;
}

// Pasted/duplicated copies land offset from the originals, with fresh ids
// — edges are only kept when both of their ends were part of the copy.
export function duplicateSelection(
  data: CanvasData,
  nodeIds: Set<string>,
  offset = { x: 30, y: 30 },
  makeId: () => string = generateCanvasId
): CanvasData {
  const idMap = new Map<string, string>();
  const nodes = data.nodes
    .filter((n) => nodeIds.has(n.id))
    .map((n) => {
      const id = makeId();
      idMap.set(n.id, id);
      return { ...n, id, x: n.x + offset.x, y: n.y + offset.y };
    });
  const edges = data.edges
    .filter((e) => idMap.has(e.fromNode) && idMap.has(e.toNode))
    .map((e) => ({ ...e, id: makeId(), fromNode: idMap.get(e.fromNode)!, toNode: idMap.get(e.toNode)! }));
  return { nodes, edges };
}

// --- Undo/redo history ---

export interface CanvasHistory {
  past: CanvasData[];
  present: CanvasData;
  future: CanvasData[];
}

export const MAX_HISTORY = 100;

export function createHistory(initial: CanvasData): CanvasHistory {
  return { past: [], present: initial, future: [] };
}

function sameCanvas(a: CanvasData, b: CanvasData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// A no-op commit (e.g. clicking a card without moving it fires a drag-stop)
// is ignored rather than recorded as an undo step that visibly does nothing.
export function pushHistory(history: CanvasHistory, next: CanvasData): CanvasHistory {
  if (sameCanvas(history.present, next)) return history;
  const past = [...history.past, history.present];
  if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
  return { past, present: next, future: [] };
}

// Folds `next` into the current undo step instead of adding a new one —
// for finishing the text of a card that was only just created, so undo
// takes back "added a card saying X" in one go, the way you'd expect,
// rather than first emptying the card and then removing it.
export function amendHistory(history: CanvasHistory, next: CanvasData): CanvasHistory {
  if (sameCanvas(history.present, next)) return history;
  return { past: history.past, present: next, future: [] };
}

export function undoHistory(history: CanvasHistory): CanvasHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory(history: CanvasHistory): CanvasHistory {
  if (history.future.length === 0) return history;
  const [next, ...future] = history.future;
  return { past: [...history.past, history.present], present: next, future };
}
