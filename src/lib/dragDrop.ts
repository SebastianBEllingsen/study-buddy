// Shared native HTML5 drag-and-drop payload helpers, used by both the home
// page (course reordering) and the course detail page (folder reordering,
// moving documents/generated items into folders).
const DRAG_MIME = "application/x-studybuddy-drag";

export type DragPayload =
  | { kind: "document"; id: number }
  | { kind: "item"; id: number }
  | { kind: "note"; id: number }
  | { kind: "canvas"; id: number }
  | { kind: "folder"; id: number }
  | { kind: "course"; id: number }
  | { kind: "widget"; id: string };

export function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

export function readDragPayload(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}
