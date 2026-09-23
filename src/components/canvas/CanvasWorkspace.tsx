"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Download, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import type { Canvas, LinkTargets } from "@/lib/models";
import { canvasFileName, serializeCanvas, type CanvasData } from "@/lib/canvas";
import CanvasBoard from "./CanvasBoard";

const EMPTY_TARGETS: LinkTargets = { notes: [], documents: [], items: [] };

// Same debounce as a note's autosave (see NoteWorkspace) — the board only
// reports a change at the end of each gesture, so this mostly just batches
// a quick run of edits into one PATCH.
const AUTOSAVE_DELAY_MS = 800;

export default function CanvasWorkspace({ canvasId }: { canvasId: number }) {
  const router = useRouter();
  const { data: detail, error: notFound, mutate } = useSWR<{ canvas: Canvas }>(`/api/canvases/${canvasId}`);
  const { data: targets } = useSWR<LinkTargets>("/api/link-targets");
  const { data: courseData } = useSWR<{ course: { name: string } | null }>(
    detail ? `/api/courses/${detail.canvas.course_id}` : null
  );
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFields = useRef<{ title?: string; data?: CanvasData }>({});

  // Seeded once per canvas id (render-phase, like NoteWorkspace) so a
  // background revalidation never clobbers a title being typed.
  const [seededFor, setSeededFor] = useState<number | null>(null);
  if (detail && detail.canvas.id !== seededFor) {
    setTitle(detail.canvas.title);
    setSeededFor(detail.canvas.id);
  }

  // Feeds the "Recent activity" dashboard widget, same as NoteWorkspace.
  useEffect(() => {
    fetch("/api/recent-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "canvas", id: canvasId }),
    }).catch(() => {});
  }, [canvasId]);

  // Flush a save still waiting in the debounce window when leaving the page
  // (e.g. opening a note card) — keepalive lets it outlive the unmount.
  useEffect(() => {
    return () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      const fields = pendingFields.current;
      pendingFields.current = {};
      if (Object.keys(fields).length === 0) return;
      fetch(`/api/canvases/${canvasId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        keepalive: true,
      }).catch(() => {});
    };
  }, [canvasId]);

  const scheduleSave = useCallback(
    (fields: { title?: string; data?: CanvasData }) => {
      setSaveState("saving");
      pendingFields.current = { ...pendingFields.current, ...fields };
      // Keeps SWR's cached copy current too — the board is seeded from that
      // cache when you come back to this canvas, and a stale copy there would
      // show (and then autosave over) the board as it was before these edits.
      mutate(
        (prev) => (prev ? { canvas: { ...prev.canvas, ...fields } } : prev),
        { revalidate: false }
      );
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const toSend = pendingFields.current;
        pendingFields.current = {};
        saveTimer.current = null;
        const res = await fetch(`/api/canvases/${canvasId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toSend),
        }).catch(() => null);
        if (!res?.ok) {
          const body = await res?.json().catch(() => ({}));
          toast.error(body?.error ?? "Couldn't save canvas");
          setSaveState("idle");
          return;
        }
        setSaveState("saved");
      }, AUTOSAVE_DELAY_MS);
    },
    [canvasId, mutate]
  );

  const handleDataChange = useCallback((data: CanvasData) => scheduleSave({ data }), [scheduleSave]);
  const navigate = useCallback((href: string) => router.push(href), [router]);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (value.trim()) scheduleSave({ title: value.trim() });
  }

  // Downloads the board as a JSON Canvas file — the same format Obsidian
  // uses, so it can be re-imported here (Canvases → Import) or opened in
  // Obsidian. Reads from SWR's copy, which scheduleSave keeps current with
  // every change, so it's the board as you see it even mid-debounce.
  function handleExport() {
    if (!detail) return;
    const blob = new Blob([serializeCanvas(detail.canvas.data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = canvasFileName(title || detail.canvas.title);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    pendingFields.current = {};
    const res = await fetch(`/api/canvases/${canvasId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete canvas");
      return;
    }
    router.push(detail ? `/courses/${detail.canvas.course_id}` : "/");
  }

  if (notFound) {
    return (
      <div className="space-y-4 p-4">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Home
        </Link>
        <p className="text-sm text-muted-foreground">This canvas doesn&apos;t exist anymore.</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  const courseHref = `/courses/${detail.canvas.course_id}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2 sm:px-6">
        <Link
          href={courseHref}
          className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span className="max-w-40 truncate">{courseData?.course?.name ?? "Course"}</span>
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <Input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          aria-label="Canvas title"
          className="h-8 min-w-0 flex-1 border-none bg-transparent px-1 font-heading text-lg font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
          placeholder="Untitled canvas"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
        <RowActionsMenu
          ariaLabel="Canvas actions"
          actions={[{ label: "Export as .canvas file", icon: Download, onSelect: handleExport }]}
          deleteLabel="Delete canvas"
          deleteDescription="This can't be undone. Notes and documents on it aren't affected — only the board itself is deleted."
          onDelete={handleDelete}
        />
        {/* Close leaves the canvas rather than acting on it — past a
            divider, same as a note's header. */}
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="icon-sm" aria-label="Close canvas" onClick={() => router.push(courseHref)}>
          <X className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <CanvasBoard
          key={detail.canvas.id}
          canvasId={detail.canvas.id}
          courseId={detail.canvas.course_id}
          initialData={detail.canvas.data}
          targets={targets ?? EMPTY_TARGETS}
          onDataChange={handleDataChange}
          navigate={navigate}
        />
      </div>
    </div>
  );
}
