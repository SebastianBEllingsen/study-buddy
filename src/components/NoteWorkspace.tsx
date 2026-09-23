"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, ExternalLink, GitFork, Link2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { CanvasBacklink, Note, NoteBacklink } from "@/lib/models";
import { stripNoteLinkSyntax } from "@/lib/noteLinks";
import NoteEditor, { type NoteEditorHandle } from "@/components/NoteEditor";
import NoteSyntaxHelp from "@/components/NoteSyntaxHelp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ICON_CHOICES } from "@/lib/pickerChoices";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface NoteDetail {
  note: Note;
  backlinks: NoteBacklink[];
  canvasBacklinks?: CanvasBacklink[];
}

// How long to wait after the last keystroke before autosaving — Obsidian
// itself autosaves rather than requiring an explicit Save action, and a
// short debounce here avoids a PATCH per keystroke.
const AUTOSAVE_DELAY_MS = 800;

// The note-editing pane shared by the normal /vault/[noteId] page and its
// detached-window counterpart (/vault/[noteId]/detached) — everything about
// loading, autosaving, and rendering a note lives here so the two can't
// drift out of sync (see scheduleSave's unmount-flush behavior below, easy
// to silently lose if duplicated). `detached` swaps out the chrome that
// doesn't make sense in a standalone popped-out window (the "← Course"/
// Close controls have nowhere meaningful to navigate to from a separate
// window) and sets the OS window title directly, mirroring
// DetachedDocumentView's own convention.
export default function NoteWorkspace({ noteId, detached = false }: { noteId: number; detached?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlight = searchParams.get("highlight");

  // Cached across navigation (see SWRProvider) — coming back to a note you
  // had open a moment ago shows it instantly instead of blanking to the
  // skeleton below and re-fetching from zero.
  const { data: detail, error: notFound, mutate } = useSWR<NoteDetail>(`/api/notes/${noteId}`);
  const { data: courseData } = useSWR<{ course: { name: string } | null }>(
    detail ? `/api/courses/${detail.note.course_id}` : null
  );
  const courseName = courseData?.course?.name ?? null;
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // Preview is read-only for the note body (NoteEditor renders it as
  // rendered markdown, not an editable field) — the title above it should
  // follow suit rather than staying editable while everything below it isn't.
  const [noteMode, setNoteMode] = useState<"edit" | "preview">("edit");
  const [deleting, setDeleting] = useState(false);
  const editorRef = useRef<NoteEditorHandle>(null);
  // Memoized on the primitive fields — NoteEditor rebuilds its CodeMirror
  // extensions whenever this object's identity changes.
  const loadedNoteId = detail?.note.id;
  const courseId = detail?.note.course_id;
  const folderId = detail?.note.folder_id ?? null;
  const linkContext = useMemo(
    () =>
      loadedNoteId !== undefined && courseId !== undefined ? { noteId: loadedNoteId, courseId, folderId } : undefined,
    [loadedNoteId, courseId, folderId]
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fields from scheduleSave calls that haven't been sent yet — merged
  // rather than replaced, so e.g. a title edit followed shortly by a
  // markdown edit doesn't cancel/drop the still-unsent title change when the
  // shared debounce timer restarts for the markdown one.
  const pendingFields = useRef<{ title?: string; markdown?: string }>({});
  const noteIdRef = useRef(noteId);
  useEffect(() => {
    noteIdRef.current = noteId;
  }, [noteId]);

  // Seeds title/markdown from the fetched note the moment its data first
  // arrives for THIS note id — render-phase sync (see CustomizeCourseDialog's
  // seededFor) rather than a useEffect, so a background SWR revalidation
  // (e.g. window refocus) never clobbers an in-progress edit sitting in
  // these two fields between autosaves.
  const [seededFor, setSeededFor] = useState<number | null>(null);
  if (detail && detail.note.id !== seededFor) {
    setTitle(detail.note.title);
    setMarkdown(detail.note.markdown);
    setSeededFor(detail.note.id);
  }

  useEffect(() => {
    // Feeds the "Recent activity" dashboard widget — only on a genuine visit
    // to a (possibly new) note id, not on every later revalidation.
    fetch("/api/recent-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "note", id: noteId }),
    }).catch(() => {});
  }, [noteId]);

  useEffect(() => {
    if (highlight && detail) {
      editorRef.current?.scrollToHighlight(highlight);
    } else if (detail && window.location.hash.length > 1) {
      // A [[Note#Heading]] link — see NoteEditor's scrollToHeading.
      let slug = window.location.hash.slice(1);
      try {
        slug = decodeURIComponent(slug);
      } catch {
        // Not valid percent-encoding — use the fragment as-is.
      }
      editorRef.current?.scrollToHeading(slug);
    }
    // Runs once when this note's content first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.note.id]);

  // A detached window's own OS title should read the note's title rather
  // than the app's generic one — deferred to a macrotask, same as
  // DetachedDocumentView, so it applies after the root layout's own async
  // generateMetadata streams the real <title> in (a plain synchronous set
  // here would otherwise lose that race).
  useEffect(() => {
    if (!detached || !detail) return;
    const timer = setTimeout(() => {
      window.document.title = detail.note.title || "Untitled";
    }, 0);
    return () => clearTimeout(timer);
  }, [detached, detail]);

  // Navigating away (e.g. the Close button or the breadcrumb link, both of
  // which route to a different page entirely) unmounts this component. A
  // save still pending in the debounce window at that point — which can be
  // as recent as a picture just pasted in — has to be flushed here instead
  // of just cancelled, or that edit is silently lost. keepalive lets the
  // request outlive the unmount that triggers it.
  useEffect(() => {
    return () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      const fields = pendingFields.current;
      pendingFields.current = {};
      if (Object.keys(fields).length === 0) return;
      fetch(`/api/notes/${noteIdRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  function scheduleSave(fields: { title?: string; markdown?: string }) {
    setSaveState("saving");
    pendingFields.current = { ...pendingFields.current, ...fields };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const toSend = pendingFields.current;
      pendingFields.current = {};
      saveTimer.current = null;
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSend),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't save note");
        setSaveState("idle");
        return;
      }
      setSaveState("saved");
    }, AUTOSAVE_DELAY_MS);
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    scheduleSave({ title: value });
  }

  function handleMarkdownChange(value: string) {
    setMarkdown(value);
    scheduleSave({ markdown: value });
  }

  async function handleIconChange(icon: string | null) {
    if (!detail) return;
    mutate({ ...detail, note: { ...detail.note, icon } }, { revalidate: false });
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icon }),
    });
  }

  // Pops this note into its own browser window — e.g. so it can sit next to
  // the course page while browsing other material — then returns this tab
  // to the course, mirroring DocumentViewer's own Detach (the content has
  // moved, not duplicated). Only rendered from the non-detached view below —
  // an already-detached window has nothing further to detach.
  function handleDetach() {
    if (!detail) return;
    window.open(
      `/vault/${detail.note.id}/detached`,
      `study-buddy-note-${detail.note.id}`,
      "noopener,width=900,height=1000"
    );
    router.push(`/courses/${detail.note.course_id}`);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete note");
        return;
      }
      if (detached) {
        // Nothing left to show in a standalone window — same instinct as
        // closing a document's detached window after it's gone, though
        // there's no equivalent there since documents can't be deleted from
        // the viewer. Silently no-ops if the browser won't allow a
        // script-closed window (e.g. it wasn't opened via window.open).
        window.close();
      } else {
        router.push(detail ? `/courses/${detail.note.course_id}` : "/");
      }
    } finally {
      setDeleting(false);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4 p-4">
        {!detached && (
          <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            Home
          </Link>
        )}
        <p className="text-sm text-muted-foreground">This note doesn&apos;t exist anymore.</p>
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

  const canvasBacklinks = detail.canvasBacklinks ?? [];
  const backlinkCount = detail.backlinks.length + canvasBacklinks.length;

  return (
    <div className="flex h-full flex-col gap-2 px-4 py-3 sm:px-8">
      <div className="flex shrink-0 items-center justify-between gap-2">
        {detached ? (
          <span />
        ) : (
          <Link
            href={`/courses/${detail.note.course_id}`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {courseName ?? "Course"}
          </Link>
        )}
        {/* Save status, then the note's actions as one tight run of
            identical ghost icon buttons, then — past a divider, like the app
            header's — close, which leaves the note rather than acting on it. */}
        <div className="flex items-center gap-1">
          <span className="mr-2 text-xs text-muted-foreground">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
          </span>
          <NoteSyntaxHelp />
          {!detached && (
            <Button variant="ghost" size="icon-sm" aria-label="Detach note" onClick={handleDetach}>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label="Delete note">
              <Trash2 className="size-3.5 text-muted-foreground" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                <AlertDialogDescription>
                  This can&apos;t be undone. Links to it from other notes will point nowhere.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleDelete}>
                  {deleting ? "Deleting…" : "Delete note"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {/* The "← Course" link above doubles as a way back, but it reads
              as "go to this course" rather than "close this note" — this
              is the same destination, just in the conventional top-right
              spot so it's recognizable as a close action on its own,
              regardless of how you arrived here (search, a link from
              another note, recent activity, ...). Not offered when detached
              — a standalone window's OS close button already does this. */}
          {!detached && <div className="mx-1 h-5 w-px shrink-0 bg-border" />}
          {!detached && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close note"
              onClick={() => router.push(`/courses/${detail.note.course_id}`)}
            >
              <X className="size-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-xl"
                aria-label="Choose an icon for this note"
              />
            }
          >
            {detail.note.icon ?? "🗒️"}
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3">
            <div className="grid grid-cols-8 gap-1">
              {ICON_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => handleIconChange(detail.note.icon === choice ? null : choice)}
                  className={`flex size-6 items-center justify-center rounded-md text-sm transition-colors hover:bg-muted ${
                    detail.note.icon === choice ? "bg-muted ring-1 ring-primary" : ""
                  }`}
                  aria-label={`Use ${choice} as icon`}
                >
                  {choice}
                </button>
              ))}
            </div>
            {detail.note.icon && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => handleIconChange(null)}>
                Remove icon
              </Button>
            )}
          </PopoverContent>
        </Popover>
        <Input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          readOnly={noteMode === "preview"}
          // px-1.5, not px-0 — flush against the icon read as cramped (a
          // 6px flex gap alone, at text-2xl) rather than intentionally
          // heading-like. bg-transparent dark:bg-transparent overrides the
          // base Input's own dark:bg-input/30 — without it this still
          // reads as a form field (a visible tinted box) rather than
          // plain heading text sitting on the page, dark mode especially.
          className="h-auto min-w-0 flex-1 border-none bg-transparent px-1.5 font-heading text-2xl font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent read-only:cursor-default"
          placeholder="Untitled"
        />
      </div>

      {/* No border/rounded box here on purpose — Obsidian's own note view
          has no visible card around the text either, just a thin
          border-b under its breadcrumb bar (see NoteEditor's own toolbar
          row) and then the page itself. A bordered container around this
          read as a widget embedded in the page rather than the page. */}
      <div className="min-h-0 flex-1">
        <NoteEditor
          ref={editorRef}
          value={markdown}
          onChange={handleMarkdownChange}
          onModeChange={setNoteMode}
          linkContext={linkContext}
        />
      </div>

      {backlinkCount > 0 && (
        <div className="max-h-32 shrink-0 space-y-1.5 overflow-y-auto rounded-xl border bg-muted/20 p-3">
          <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="size-3.5" />
            {backlinkCount} backlink{backlinkCount === 1 ? "" : "s"}
          </h2>
          <ul className="space-y-1">
            {detail.backlinks.map((bl, i) => (
              <li key={i}>
                <Link
                  // The highlight anchor has to be the RAW line (including
                  // its [[...]] syntax) since that's what actually appears
                  // in the source note's text for NoteEditor's
                  // scrollToHighlight to find — only the visible label
                  // below is prettified.
                  href={`/vault/${bl.noteId}?highlight=${encodeURIComponent(bl.context)}`}
                  className="block rounded-md px-2 py-1 -mx-2 text-sm hover:bg-muted"
                >
                  <span className="font-medium">{bl.noteTitle}</span>{" "}
                  <span className="text-muted-foreground">— {stripNoteLinkSyntax(bl.context)}</span>
                </Link>
              </li>
            ))}
            {/* A canvas showing this note (as a card, or via a [[link]] in
                one of its text cards) counts as a backlink too, like
                Obsidian — see getCanvasBacklinksForNote. */}
            {canvasBacklinks.map((bl) => (
              <li key={`canvas-${bl.canvasId}`}>
                <Link
                  href={`/canvas/${bl.canvasId}`}
                  className="-mx-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-muted"
                >
                  <GitFork className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{bl.canvasTitle}</span>
                  <span className="text-muted-foreground">— canvas</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
