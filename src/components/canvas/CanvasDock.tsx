"use client";

import { useMemo, useRef, useState } from "react";
import { BoxSelect, FileText, HelpCircle, ImagePlus, Layers, NotebookPen, SquarePlus, StickyNote } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CanvasFileRef } from "@/lib/canvas";
import type { GenerationMode, LinkTargets } from "@/lib/models";
import { ToolbarButton, ToolbarDivider, ToolbarShell } from "./CanvasToolbarParts";

// Dragging a dock button onto the board drops that kind of card right
// where you let go (clicking instead places it in the middle of the view)
// — Obsidian's own "drag to add" affordance.
export const CANVAS_TOOL_MIME = "application/x-studybuddy-canvas-tool";
export type CanvasTool = "text" | "group";

const MODE_ICON: Record<GenerationMode, LucideIcon> = {
  notes: NotebookPen,
  quiz: HelpCircle,
  flashcards: Layers,
};

interface PickerEntry {
  ref: CanvasFileRef;
  title: string;
  courseId: number;
  courseName: string;
  icon: LucideIcon;
}

// Notes (or documents + generated items) from every course, this canvas's
// own course first — linking crosses course boundaries on a canvas the same
// way [[links]] do in a note. A small client-side filter rather than a
// search endpoint, same reasoning as /api/link-targets itself.
function MaterialPicker({
  label,
  icon: Icon,
  entries,
  courseId,
  emptyText,
  onPick,
}: {
  label: string;
  icon: LucideIcon;
  entries: PickerEntry[];
  courseId: number;
  emptyText: string;
  onPick: (ref: CanvasFileRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.courseName.toLowerCase().includes(q))
      .sort((a, b) => Number(b.courseId === courseId) - Number(a.courseId === courseId));
  }, [entries, query, courseId]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={label}
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground [&_svg]:size-4"
                />
              }
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="center" sideOffset={10} className="nodrag nopan w-80 p-0">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              onPick(results[0].ref);
              setOpen(false);
              setQuery("");
            }
          }}
          placeholder="Search…"
          className="w-full border-b bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-72 overflow-y-auto p-1">
          {results.length === 0 ? (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">{entries.length ? "No matches" : emptyText}</li>
          ) : (
            results.map((entry) => (
              <li key={`${entry.ref.type}:${entry.ref.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(entry.ref);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <entry.icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  {entry.courseId !== courseId && (
                    <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{entry.courseName}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function DraggableTool({
  tool,
  label,
  onAdd,
  children,
}: {
  tool: CanvasTool;
  label: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <ToolbarButton
      label={label}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CANVAS_TOOL_MIME, tool);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onAdd}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </ToolbarButton>
  );
}

export function CanvasDock({
  targets,
  courseId,
  onAddText,
  onAddGroup,
  onAddFile,
  onAddImages,
}: {
  targets: LinkTargets;
  courseId: number;
  onAddText: () => void;
  onAddGroup: () => void;
  onAddFile: (ref: CanvasFileRef) => void;
  onAddImages: (files: File[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const noteEntries = useMemo<PickerEntry[]>(
    () =>
      targets.notes.map((n) => ({
        ref: { type: "note", id: n.id },
        title: n.title,
        courseId: n.courseId,
        courseName: n.courseName,
        icon: StickyNote,
      })),
    [targets.notes]
  );
  const materialEntries = useMemo<PickerEntry[]>(
    () => [
      ...targets.documents.map((d) => ({
        ref: { type: "doc" as const, id: d.id },
        title: d.filename,
        courseId: d.courseId,
        courseName: d.courseName,
        icon: FileText,
      })),
      ...targets.items.map((i) => ({
        ref: { type: "item" as const, id: i.id },
        title: i.title,
        courseId: i.courseId,
        courseName: i.courseName,
        icon: MODE_ICON[i.mode],
      })),
    ],
    [targets.documents, targets.items]
  );

  return (
    <ToolbarShell className="px-1.5">
      <DraggableTool tool="text" label="Add card — click, or drag onto the canvas" onAdd={onAddText}>
        <SquarePlus />
      </DraggableTool>
      <MaterialPicker
        label="Add note from vault"
        icon={StickyNote}
        entries={noteEntries}
        courseId={courseId}
        emptyText="No notes yet"
        onPick={onAddFile}
      />
      <MaterialPicker
        label="Add document or study set"
        icon={FileText}
        entries={materialEntries}
        courseId={courseId}
        emptyText="No documents or generated items yet"
        onPick={onAddFile}
      />
      <ToolbarButton label="Add image" onClick={() => fileInput.current?.click()}>
        <ImagePlus />
      </ToolbarButton>
      <ToolbarDivider />
      <DraggableTool tool="group" label="Add group — click, or drag onto the canvas" onAdd={onAddGroup}>
        <BoxSelect />
      </DraggableTool>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAddImages(files);
        }}
      />
    </ToolbarShell>
  );
}
