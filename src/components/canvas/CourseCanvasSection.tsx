"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitFork, GripVertical, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import { HelpTooltip } from "@/components/HelpTooltip";
import type { CanvasSummary } from "@/lib/models";
import { readDragPayload, setDragPayload } from "@/lib/dragDrop";
import { canvasTitleFromFileName, parseCanvasFile } from "@/lib/canvas";

// The course page's "Canvases" section — its own flat list, separate from
// the folder tree, since a canvas usually pulls together material from
// several folders rather than belonging inside one.
export function CourseCanvasSection({
  courseId,
  canvases,
  onChanged,
}: {
  courseId: number;
  canvases: CanvasSummary[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  // A .canvas file from Obsidian or from this app's own Export. Cards that
  // point at files in an Obsidian vault come across as placeholders (the
  // files themselves aren't part of Study Buddy); everything else — text
  // cards, groups, links, arrows — imports as-is.
  async function handleImport(file: File) {
    setImporting(true);
    const toastId = toast.loading("Importing canvas…");
    try {
      const data = parseCanvasFile(await file.text());
      if (!data) {
        toast.error("That file isn't a canvas");
        return;
      }
      const res = await fetch(`/api/courses/${courseId}/canvases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: canvasTitleFromFileName(file.name), data }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't import canvas");
        return;
      }
      router.push(`/canvas/${body.canvas.id}`);
    } finally {
      toast.dismiss(toastId);
      setImporting(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/canvases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't create canvas");
        return;
      }
      setOpen(false);
      setTitle("");
      router.push(`/canvas/${body.canvas.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/canvases/${id}`, { method: "DELETE" });
    onChanged();
  }

  // Same reorder-by-drop-on-a-sibling-row pattern as the course page's
  // NoteList.
  async function handleDrop(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (payload?.kind !== "canvas" || payload.id === targetId) return;
    const ids = canvases.map((c) => c.id);
    const from = ids.indexOf(payload.id);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, payload.id);
    await fetch(`/api/courses/${courseId}/canvases/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: ids }),
    });
    onChanged();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 font-heading text-base font-semibold">
          Canvases
          <HelpTooltip>
            An infinite board for mapping out a topic: cards of your own, notes, documents and images, joined by
            labeled arrows.
          </HelpTooltip>
        </h2>
        <div className="flex items-center">
          {/* Same quiet "+" as each folder row's — the course's one filled
              "+" is the Folders header's. */}
          <RowActionsMenu
            ariaLabel="Add canvas"
            triggerIcon={Plus}
            actions={[
              { label: "New canvas", icon: GitFork, onSelect: () => setOpen(true) },
              {
                label: "Import .canvas file",
                icon: Upload,
                onSelect: () => {
                  if (!importing) importInput.current?.click();
                },
              },
            ]}
          />
          <input
            ref={importInput}
            type="file"
            accept=".canvas,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleImport(file);
            }}
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>New canvas</DialogTitle>
                  <DialogDescription>Give it a name, e.g. &quot;Exam 1 overview&quot;.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-4">
                  <Label htmlFor="canvas-title">Name</Label>
                  <Input
                    id="canvas-title"
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Untitled canvas"
                  />
                </div>
                <DialogFooter>
                  <DialogCancel />
                  <Button type="submit" disabled={creating || !title.trim()}>
                    {creating ? "Creating…" : "Create canvas"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {canvases.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">No canvases yet — use + to create or import one.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {canvases.map((canvas) => (
            <li
              key={canvas.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, canvas.id)}
              className="group/row flex items-center justify-between gap-2 px-1 py-2 text-sm hover:bg-muted/40"
            >
              <div
                draggable
                onDragStart={(e) => setDragPayload(e, { kind: "canvas", id: canvas.id })}
                className="flex min-w-0 cursor-grab select-none items-center gap-1.5 active:cursor-grabbing"
              >
                <GripVertical className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-focus-within/row:text-muted-foreground group-hover/row:text-muted-foreground [@media(hover:none)]:hidden" />
                <GitFork className="size-3.5 shrink-0 text-focus/70" />
                <Link href={`/canvas/${canvas.id}`} draggable={false} className="truncate hover:underline">
                  {canvas.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(canvas.updated_at.replace(" ", "T") + "Z").toLocaleDateString()}
                </span>
              </div>
              <RowActionsMenu
                ariaLabel={`Actions for ${canvas.title}`}
                deleteLabel="Delete canvas"
                deleteDescription="This can't be undone. Notes and documents on it aren't affected."
                onDelete={() => handleDelete(canvas.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
