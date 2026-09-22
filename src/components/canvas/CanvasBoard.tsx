"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  MarkerType,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
  type Viewport,
} from "@xyflow/react";
import { toast } from "sonner";
import {
  BoxSelect,
  ExternalLink,
  Keyboard,
  Maximize,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Scan,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  amendHistory,
  createHistory,
  DEFAULT_FILE_NODE_SIZE,
  DEFAULT_GROUP_SIZE,
  DEFAULT_TEXT_NODE_SIZE,
  duplicateSelection,
  generateCanvasId,
  nearestSide,
  nodesInsideGroup,
  parseFileRef,
  placeNodeAtDrop,
  pushHistory,
  redoHistory,
  undoHistory,
  type CanvasColor,
  type CanvasData,
  type CanvasFileRef,
  type CanvasHistory,
  type CanvasSide,
} from "@/lib/canvas";
import {
  canvasToFlow,
  CARD_Z_INDEX,
  flowToCanvas,
  GROUP_Z_INDEX,
  type CanvasEdgeData,
  type CanvasFlowEdge,
  type CanvasFlowNode,
  type CanvasNodeData,
} from "@/lib/canvasFlow";
import type { LinkTargets } from "@/lib/models";
import { noteImageCache, uploadNoteImage } from "@/lib/noteImages";
import { describeUploadError } from "@/lib/uploadImage";
import { CanvasContext, canvasColorValue, type CanvasActions } from "./CanvasContext";
import { canvasNodeTypes, fileCardHref } from "./CanvasNodes";
import { canvasEdgeTypes } from "./CanvasEdge";
import { CANVAS_TOOL_MIME, CanvasDock, type CanvasTool } from "./CanvasDock";
import { ColorPicker, ToolbarButton, ToolbarDivider, ToolbarShell } from "./CanvasToolbarParts";

interface CanvasBoardProps {
  canvasId: number;
  courseId: number;
  initialData: CanvasData;
  targets: LinkTargets;
  // Called with the whole board after every committed change (not every
  // drag frame or keystroke) — the parent debounces this into an autosave.
  onDataChange: (data: CanvasData) => void;
  navigate: (href: string) => void;
}

const SMALL_FILE_CARD_SIZE = { width: 320, height: 150 };
const GROUP_PADDING = 40;
const MAX_IMAGE_CARD_WIDTH = 400;

const SHORTCUTS: [string, string][] = [
  ["Double-click empty space", "New card"],
  ["Drag a card's edge dot", "Connect — drop on empty space for a new card"],
  ["Double-click a card / arrow", "Edit text / label"],
  ["Drag on empty space", "Select several"],
  ["Space + drag, or scroll", "Pan"],
  ["Ctrl + scroll, or pinch", "Zoom"],
  ["Delete / Backspace", "Delete selection"],
  ["Ctrl + Z / Ctrl + Shift + Z", "Undo / redo"],
  ["Ctrl + D", "Duplicate selection"],
  ["Ctrl + A", "Select everything"],
  ["Enter / Esc", "Edit selected card / stop editing"],
  ["Paste", "An image, link, or text becomes a card"],
];

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function viewportKey(canvasId: number) {
  return `study-buddy-canvas-viewport-${canvasId}`;
}

// Per-viewer convenience only — reopening a board where you left it. Any
// storage failure (private window, blocked site data) just means the board
// opens fitted to its contents instead.
function readSavedViewport(canvasId: number): Viewport | null {
  try {
    const raw = window.localStorage.getItem(viewportKey(canvasId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && [parsed.x, parsed.y, parsed.zoom].every(Number.isFinite) ? parsed : null;
  } catch {
    return null;
  }
}

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = url;
  });
}

function nodeRect(node: CanvasFlowNode) {
  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? node.measured?.width ?? 0,
    height: node.height ?? node.measured?.height ?? 0,
  };
}

function newEdge(source: string, sourceSide: CanvasSide | undefined, target: string, targetSide: CanvasSide | undefined): CanvasFlowEdge {
  return {
    id: generateCanvasId(),
    type: "canvas",
    source,
    target,
    sourceHandle: sourceSide ?? null,
    targetHandle: targetSide ?? null,
    data: { fromEnd: "none", toEnd: "arrow" },
  };
}

function Board({ canvasId, courseId, initialData, targets, onDataChange, navigate }: CanvasBoardProps) {
  const rf = useReactFlow<CanvasFlowNode, CanvasFlowEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [initialFlow] = useState(() => canvasToFlow(initialData));
  const [savedViewport] = useState(() => readSavedViewport(canvasId));

  // Nodes/edges live in state (what React Flow renders) AND in a ref kept in
  // lockstep by the setters below — so commit() can snapshot the board
  // synchronously right after a change, instead of waiting a render for
  // state to catch up (which would record undo steps one change late).
  const [nodes, setNodesState] = useState<CanvasFlowNode[]>(initialFlow.nodes);
  const [edges, setEdgesState] = useState<CanvasFlowEdge[]>(initialFlow.edges);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const setNodes = useCallback((update: CanvasFlowNode[] | ((prev: CanvasFlowNode[]) => CanvasFlowNode[])) => {
    const next = typeof update === "function" ? update(nodesRef.current) : update;
    nodesRef.current = next;
    setNodesState(next);
  }, []);
  const setEdges = useCallback((update: CanvasFlowEdge[] | ((prev: CanvasFlowEdge[]) => CanvasFlowEdge[])) => {
    const next = typeof update === "function" ? update(edgesRef.current) : update;
    edgesRef.current = next;
    setEdgesState(next);
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // --- Undo/redo + autosave ---
  const historyRef = useRef<CanvasHistory | null>(null);
  if (historyRef.current === null) historyRef.current = createHistory(initialData);
  const [historyInfo, setHistoryInfo] = useState({ canUndo: false, canRedo: false });
  const onDataChangeRef = useRef(onDataChange);
  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  const syncHistoryInfo = useCallback((h: CanvasHistory) => {
    setHistoryInfo({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
  }, []);

  // The card that was just created and opened for typing, if any — when its
  // first edit finishes, that edit is folded into the "added a card" undo
  // step (see amendHistory) instead of becoming a step of its own.
  const freshCardRef = useRef<string | null>(null);

  // Records the board as it is right now as one undo step and hands it to
  // the parent for saving. Called at the END of each gesture (drag stop,
  // resize end, edit finished, card added/deleted) — never per frame.
  const commit = useCallback((amend = false) => {
    if (!amend) freshCardRef.current = null;
    const data = flowToCanvas(nodesRef.current, edgesRef.current);
    const next = amend ? amendHistory(historyRef.current!, data) : pushHistory(historyRef.current!, data);
    if (next === historyRef.current) return;
    historyRef.current = next;
    syncHistoryInfo(next);
    onDataChangeRef.current(data);
  }, [syncHistoryInfo]);

  const restore = useCallback(
    (h: CanvasHistory) => {
      if (h === historyRef.current) return;
      historyRef.current = h;
      freshCardRef.current = null;
      const flow = canvasToFlow(h.present);
      // React Flow only draws a node's edges once it has a measured size,
      // and it only re-measures when the DOM size actually changes — so a
      // restored node object that drops `measured` (which the stored
      // format doesn't carry) would leave every edge to it invisible.
      // Carrying the last measurement over keeps them drawn; a node whose
      // size did change gets re-measured by React Flow as usual.
      const measured = new Map(nodesRef.current.map((n) => [n.id, n.measured]));
      setNodes(flow.nodes.map((n) => (measured.get(n.id) ? { ...n, measured: measured.get(n.id) } : n)));
      setEdges(flow.edges);
      setEditingId(null);
      syncHistoryInfo(h);
      onDataChangeRef.current(h.present);
    },
    [setNodes, setEdges, syncHistoryInfo]
  );
  const undo = useCallback(() => restore(undoHistory(historyRef.current!)), [restore]);
  const redo = useCallback(() => restore(redoHistory(historyRef.current!)), [restore]);

  // --- Mutations exposed to cards/arrows through context ---
  const updateNodeData = useCallback(
    (id: string, patch: Partial<CanvasNodeData>, shouldCommit = false) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
      if (shouldCommit) {
        commit(freshCardRef.current === id);
        freshCardRef.current = null;
      }
    },
    [setNodes, commit]
  );
  const resizeNode = useCallback(
    (id: string, size: { width?: number; height?: number }, shouldCommit = false) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, width: size.width ?? n.width, height: size.height ?? n.height } : n))
      );
      if (shouldCommit) commit();
    },
    [setNodes, commit]
  );
  const updateEdgeData = useCallback(
    (id: string, patch: Partial<CanvasEdgeData>, shouldCommit = false) => {
      setEdges((es) =>
        es.map((e) => (e.id === id ? { ...e, data: { fromEnd: "none", toEnd: "arrow", ...e.data, ...patch } } : e))
      );
      if (shouldCommit) commit();
    },
    [setEdges, commit]
  );
  const deleteEdge = useCallback((id: string) => void rf.deleteElements({ edges: [{ id }] }), [rf]);

  const actions = useMemo<CanvasActions>(
    () => ({ editingId, setEditingId, targets, updateNodeData, resizeNode, updateEdgeData, deleteEdge, navigate }),
    [editingId, targets, updateNodeData, resizeNode, updateEdgeData, deleteEdge, navigate]
  );

  // --- React Flow change plumbing ---
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      // A resize ends with a dimensions change flagged resizing: false.
      if (changes.some((c) => c.type === "dimensions" && c.resizing === false)) commit();
      // Removals arrive as a node change and an edge change back to back;
      // committing on a microtask records them as one undo step.
      if (changes.some((c) => c.type === "remove")) queueMicrotask(commit);
    },
    [setNodes, commit]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasFlowEdge>[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type === "remove")) queueMicrotask(commit);
    },
    [setEdges, commit]
  );

  // --- Adding things ---
  const viewportCenter = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [rf]);

  // New cards arrive selected, with everything else deselected, so the
  // selection toolbar is right there for them.
  const addNodes = useCallback(
    (added: CanvasFlowNode[], addedEdges: CanvasFlowEdge[] = []) => {
      setNodes((ns) => [
        ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...added.map((n) => ({ ...n, selected: true })),
      ]);
      setEdges((es) => [...es.map((e) => (e.selected ? { ...e, selected: false } : e)), ...addedEdges]);
      commit();
    },
    [setNodes, setEdges, commit]
  );

  const makeNode = useCallback(
    (type: CanvasFlowNode["type"], center: { x: number; y: number }, size: { width: number; height: number }, data: CanvasNodeData): CanvasFlowNode => ({
      id: generateCanvasId(),
      type,
      position: { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2) },
      width: size.width,
      height: size.height,
      zIndex: type === "group" ? GROUP_Z_INDEX : CARD_Z_INDEX,
      data,
    }),
    []
  );

  const addTextAt = useCallback(
    (center: { x: number; y: number }, text = "", edit = true) => {
      const node = makeNode("text", center, DEFAULT_TEXT_NODE_SIZE, { text });
      addNodes([node]);
      if (edit) {
        freshCardRef.current = node.id;
        setEditingId(node.id);
      }
    },
    [makeNode, addNodes]
  );

  const addGroupAt = useCallback(
    (center: { x: number; y: number }) => {
      const node = makeNode("group", center, DEFAULT_GROUP_SIZE, { label: "" });
      addNodes([node]);
      freshCardRef.current = node.id;
      setEditingId(node.id);
    },
    [makeNode, addNodes]
  );

  const addFileAt = useCallback(
    (ref: CanvasFileRef, center: { x: number; y: number }) => {
      const size = ref.type === "note" ? DEFAULT_FILE_NODE_SIZE : SMALL_FILE_CARD_SIZE;
      addNodes([makeNode("file", center, size, { file: `${ref.type}:${ref.id}` })]);
    },
    [makeNode, addNodes]
  );

  const addImagesAt = useCallback(
    async (files: File[], center: { x: number; y: number }) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length < files.length) toast.error("Only images can be added to a canvas this way");
      const added: CanvasFlowNode[] = [];
      for (const [index, file] of images.entries()) {
        try {
          const imageId = await uploadNoteImage(file);
          const natural = await loadImageSize(noteImageCache.get(imageId) ?? "");
          const width = Math.min(MAX_IMAGE_CARD_WIDTH, natural.width);
          const height = Math.round((width * natural.height) / natural.width);
          const offset = index * 30;
          added.push(
            makeNode("file", { x: center.x + offset, y: center.y + offset }, { width, height }, { file: `image:${imageId}` })
          );
        } catch (err) {
          toast.error(describeUploadError(err, `Couldn't add ${file.name || "that image"}`));
        }
      }
      if (added.length) addNodes(added);
    },
    [makeNode, addNodes]
  );

  // --- Connections ---
  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) return;
      setEdges((es) => [
        ...es,
        newEdge(
          connection.source,
          (connection.sourceHandle as CanvasSide) ?? undefined,
          connection.target,
          (connection.targetHandle as CanvasSide) ?? undefined
        ),
      ]);
      commit();
    },
    [setEdges, commit]
  );

  // A connection that wasn't dropped exactly on a dot still does something
  // useful, like Obsidian: dropped on a card's body it attaches to that
  // card's nearest side; dropped on empty space it creates a new card there,
  // already connected, and opens it for typing.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      setConnecting(false);
      if (state.isValid || !state.fromNode || !state.fromHandle) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const flowPoint = rf.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const fromId = state.fromNode.id;
      const fromSide = (state.fromHandle.id as CanvasSide | null) ?? "right";

      const hit = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node");
      const hitId = hit?.getAttribute("data-id");
      if (hitId) {
        if (hitId === fromId) return;
        const target = rf.getNode(hitId);
        if (!target) return;
        setEdges((es) => [...es, newEdge(fromId, fromSide, hitId, nearestSide(nodeRect(target), flowPoint))]);
        commit();
        return;
      }

      const placed = placeNodeAtDrop(flowPoint, DEFAULT_TEXT_NODE_SIZE, fromSide);
      const node: CanvasFlowNode = {
        id: generateCanvasId(),
        type: "text",
        position: { x: Math.round(placed.x), y: Math.round(placed.y) },
        ...DEFAULT_TEXT_NODE_SIZE,
        zIndex: CARD_Z_INDEX,
        data: { text: "" },
      };
      addNodes([node], [newEdge(fromId, fromSide, node.id, placed.side)]);
      freshCardRef.current = node.id;
      setEditingId(node.id);
    },
    [rf, setEdges, commit, addNodes]
  );

  // --- Dragging a group carries whatever sits inside it ---
  const groupDrag = useRef<{ groupId: string; start: { x: number; y: number }; members: { id: string; x: number; y: number }[] }[]>([]);

  const onNodeDragStart = useCallback((_: unknown, __: unknown, dragged: CanvasFlowNode[]) => {
    const draggedIds = new Set(dragged.map((n) => n.id));
    const rects = nodesRef.current.map(nodeRect);
    const positions = new Map(nodesRef.current.map((n) => [n.id, n.position]));
    const claimed = new Set<string>();
    groupDrag.current = dragged
      .filter((n) => n.type === "group")
      .map((group) => {
        const members = nodesInsideGroup(nodeRect(group), rects)
          .filter((id) => !draggedIds.has(id) && !claimed.has(id))
          .map((id) => {
            claimed.add(id);
            const p = positions.get(id)!;
            return { id, x: p.x, y: p.y };
          });
        return { groupId: group.id, start: { ...group.position }, members };
      });
  }, []);

  const onNodeDrag = useCallback(
    (_: unknown, __: unknown, dragged: CanvasFlowNode[]) => {
      if (groupDrag.current.length === 0) return;
      const moves = new Map<string, { x: number; y: number }>();
      for (const g of groupDrag.current) {
        const current = dragged.find((n) => n.id === g.groupId);
        if (!current) continue;
        const dx = current.position.x - g.start.x;
        const dy = current.position.y - g.start.y;
        for (const m of g.members) moves.set(m.id, { x: m.x + dx, y: m.y + dy });
      }
      if (moves.size === 0) return;
      setNodes((ns) => ns.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)));
    },
    [setNodes]
  );

  const onNodeDragStop = useCallback(() => {
    groupDrag.current = [];
    commit();
  }, [commit]);

  // --- Selection helpers ---
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedIds = useMemo(() => selectedNodes.map((n) => n.id), [selectedNodes]);
  const isDragging = useMemo(() => nodes.some((n) => n.dragging), [nodes]);

  const duplicate = useCallback(() => {
    const ids = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
    if (ids.size === 0) return;
    const copy = canvasToFlow(duplicateSelection(flowToCanvas(nodesRef.current, edgesRef.current), ids));
    addNodes(copy.nodes, copy.edges);
  }, [addNodes]);

  const setSelectionColor = useCallback(
    (color: CanvasColor | undefined) => {
      const ids = new Set(selectedIds);
      setNodes((ns) => ns.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, color } } : n)));
      commit();
    },
    [selectedIds, setNodes, commit]
  );

  const groupSelection = useCallback(() => {
    const rects = nodesRef.current.filter((n) => n.selected).map(nodeRect);
    if (rects.length === 0) return;
    const minX = Math.min(...rects.map((r) => r.x)) - GROUP_PADDING;
    const minY = Math.min(...rects.map((r) => r.y)) - GROUP_PADDING;
    const maxX = Math.max(...rects.map((r) => r.x + r.width)) + GROUP_PADDING;
    const maxY = Math.max(...rects.map((r) => r.y + r.height)) + GROUP_PADDING;
    const group = makeNode(
      "group",
      { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      { width: maxX - minX, height: maxY - minY },
      { label: "" }
    );
    // Groups paint in array order among themselves — the new one goes
    // first so an existing group it wraps stays visible on top of it.
    setNodes((ns) => [{ ...group, selected: true }, ...ns.map((n) => ({ ...n, selected: false }))]);
    commit();
    freshCardRef.current = group.id;
    setEditingId(group.id);
  }, [makeNode, setNodes, commit]);

  const openNode = useCallback(
    (node: CanvasFlowNode) => {
      if (node.type === "file") {
        const ref = parseFileRef(node.data.file ?? "");
        const href = ref ? fileCardHref(ref, node.data.subpath, targets) : null;
        if (href) navigate(href);
      } else if (node.type === "link" && /^https?:\/\//i.test(node.data.url ?? "")) {
        window.open(node.data.url, "_blank", "noopener,noreferrer");
      }
    },
    [targets, navigate]
  );

  // --- Keyboard, paste, drop ---
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const pastePoint = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const p = lastPointer.current;
    if (rect && p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) {
      return rf.screenToFlowPosition(p);
    }
    return viewportCenter();
  }, [rf, viewportCenter]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        redo();
      } else if (mod && key === "d") {
        e.preventDefault();
        duplicate();
      } else if (mod && key === "a") {
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
      } else if (e.key === "Escape") {
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setEdges((es) => es.map((ed) => (ed.selected ? { ...ed, selected: false } : ed)));
      } else if (e.key === "Enter") {
        const selected = nodesRef.current.filter((n) => n.selected);
        if (selected.length === 1 && (selected[0].type === "text" || selected[0].type === "group")) {
          e.preventDefault();
          setEditingId(selected[0].id);
        }
      }
    }
    function onPaste(e: ClipboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void addImagesAt(files, pastePoint());
        return;
      }
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();
      if (/^https?:\/\/\S+$/i.test(text)) {
        addNodes([makeNode("link", pastePoint(), { width: 320, height: 110 }, { url: text })]);
      } else {
        addTextAt(pastePoint(), text, false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [undo, redo, duplicate, setNodes, setEdges, addImagesAt, addNodes, addTextAt, makeNode, pastePoint]);

  function handleDrop(e: React.DragEvent) {
    const tool = e.dataTransfer.getData(CANVAS_TOOL_MIME) as CanvasTool | "";
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!tool && files.length === 0) return;
    e.preventDefault();
    const point = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (tool === "text") addTextAt(point);
    else if (tool === "group") addGroupAt(point);
    else void addImagesAt(files, point);
  }

  // Arrowheads are React Flow markers, which have to be declared per edge
  // (and per color, so a colored arrow gets a matching head).
  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const color = canvasColorValue(e.data?.color) ?? "var(--canvas-edge)";
        const marker = { type: MarkerType.ArrowClosed, color, width: 18, height: 18, markerUnits: "userSpaceOnUse" };
        return {
          ...e,
          markerStart: e.data?.fromEnd === "arrow" ? marker : undefined,
          markerEnd: (e.data?.toEnd ?? "arrow") === "arrow" ? marker : undefined,
        };
      }),
    [edges]
  );

  const single = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const singleHref =
    single?.type === "file"
      ? (() => {
          const ref = parseFileRef(single.data.file ?? "");
          return ref ? fileCardHref(ref, single.data.subpath, targets) : null;
        })()
      : single?.type === "link"
        ? (single.data.url ?? null)
        : null;
  const selectionColor = selectedNodes.every((n) => n.data.color === selectedNodes[0]?.data.color)
    ? selectedNodes[0]?.data.color
    : undefined;

  return (
    <CanvasContext.Provider value={actions}>
      <div
        ref={wrapperRef}
        className={cn("canvas-board relative size-full", connecting && "is-connecting")}
        onPointerMove={(e) => {
          lastPointer.current = { x: e.clientX, y: e.clientY };
        }}
        onDoubleClick={(e) => {
          if (!(e.target as Element).classList.contains("react-flow__pane")) return;
          addTextAt(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(CANVAS_TOOL_MIME) || e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={handleDrop}
      >
        <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
          nodes={nodes}
          edges={displayEdges}
          nodeTypes={canvasNodeTypes}
          edgeTypes={canvasEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={() => setConnecting(true)}
          onConnectEnd={onConnectEnd}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={(e, node) => {
            if (node.type === "text") setEditingId(node.id);
            // Inside a group's empty area, a double-click makes a card
            // there, same as on the bare board.
            else if (node.type === "group") addTextAt(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            else openNode(node);
          }}
          onEdgeDoubleClick={(_, edge) => setEditingId(edge.id)}
          onMoveEnd={(_, viewport) => {
            try {
              window.localStorage.setItem(viewportKey(canvasId), JSON.stringify(viewport));
            } catch {
              // Not persisted — see readSavedViewport.
            }
          }}
          defaultViewport={savedViewport ?? undefined}
          fitView={!savedViewport}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.Bezier}
          connectionRadius={28}
          selectionOnDrag
          panOnDrag={[1, 2]}
          panOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          deleteKeyCode={["Backspace", "Delete"]}
          multiSelectionKeyCode="Shift"
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect
          nodeDragThreshold={2}
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--canvas-dot)" />

          <NodeToolbar
            nodeId={selectedIds}
            isVisible={selectedIds.length > 0 && !isDragging && editingId === null}
            position={Position.Top}
            offset={14}
          >
            <ToolbarShell>
              <ColorPicker value={selectionColor} onChange={setSelectionColor} />
              <ToolbarButton
                label="Zoom to selection"
                onClick={() => rf.fitView({ nodes: selectedIds.map((id) => ({ id })), duration: 250, padding: 0.3 })}
              >
                <Scan />
              </ToolbarButton>
              {single && (single.type === "text" || single.type === "group") && (
                <ToolbarButton label={single.type === "group" ? "Rename group" : "Edit"} shortcut="Enter" onClick={() => setEditingId(single.id)}>
                  <Pencil />
                </ToolbarButton>
              )}
              {singleHref && single && (
                <ToolbarButton label="Open" onClick={() => openNode(single)}>
                  <ExternalLink />
                </ToolbarButton>
              )}
              <ToolbarButton label="Group selection" onClick={groupSelection}>
                <BoxSelect />
              </ToolbarButton>
              <ToolbarButton
                label="Delete"
                shortcut="Del"
                onClick={() => void rf.deleteElements({ nodes: selectedIds.map((id) => ({ id })) })}
              >
                <Trash2 />
              </ToolbarButton>
            </ToolbarShell>
          </NodeToolbar>

          <Panel position="top-right">
            <ToolbarShell orientation="vertical">
              <ToolbarButton label="Zoom in" side="left" onClick={() => rf.zoomIn({ duration: 150 })}>
                <Plus />
              </ToolbarButton>
              <ToolbarButton label="Zoom out" side="left" onClick={() => rf.zoomOut({ duration: 150 })}>
                <Minus />
              </ToolbarButton>
              <ToolbarButton
                label="Fit to screen"
                side="left"
                onClick={() => rf.fitView({ padding: 0.2, duration: 250, maxZoom: 1 })}
              >
                <Maximize />
              </ToolbarButton>
              <ToolbarDivider orientation="vertical" />
              <ToolbarButton label="Undo" shortcut="Ctrl+Z" side="left" disabled={!historyInfo.canUndo} onClick={undo}>
                <Undo2 />
              </ToolbarButton>
              <ToolbarButton
                label="Redo"
                shortcut="Ctrl+Shift+Z"
                side="left"
                disabled={!historyInfo.canRedo}
                onClick={redo}
              >
                <Redo2 />
              </ToolbarButton>
              <ToolbarDivider orientation="vertical" />
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Canvas shortcuts"
                      title="Shortcuts"
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4"
                    />
                  }
                >
                  <Keyboard />
                </PopoverTrigger>
                <PopoverContent side="left" align="start" className="nodrag nopan w-96 p-3">
                  <p className="mb-2 text-sm font-medium">Canvas shortcuts</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    {SHORTCUTS.map(([keys, what]) => (
                      <div key={keys} className="contents">
                        <dt className="whitespace-nowrap font-mono text-muted-foreground">{keys}</dt>
                        <dd>{what}</dd>
                      </div>
                    ))}
                  </dl>
                </PopoverContent>
              </Popover>
            </ToolbarShell>
          </Panel>

          <Panel position="bottom-center">
            <CanvasDock
              targets={targets}
              courseId={courseId}
              onAddText={() => addTextAt(viewportCenter())}
              onAddGroup={() => addGroupAt(viewportCenter())}
              onAddFile={(ref) => addFileAt(ref, viewportCenter())}
              onAddImages={(files) => void addImagesAt(files, viewportCenter())}
            />
          </Panel>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-xs text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">An empty canvas</p>
                <p className="mt-1">Double-click anywhere to add a card, or bring in notes and material from the dock below.</p>
              </div>
            </div>
          )}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}

export default function CanvasBoard(props: CanvasBoardProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
