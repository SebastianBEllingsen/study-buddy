"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Link2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Note, NoteBacklink } from "@/lib/models";
import { stripNoteLinkSyntax } from "@/lib/noteLinks";
import NoteEditor, { type NoteEditorHandle } from "@/components/NoteEditor";
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
}

// How long to wait after the last keystroke before autosaving — Obsidian
// itself autosaves rather than requiring an explicit Save action, and a
// short debounce here avoids a PATCH per keystroke.
const AUTOSAVE_DELAY_MS = 800;

export default function NotePage() {
  const params = useParams<{ noteId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const highlight = searchParams.get("highlight");

  // Cached across navigation (see SWRProvider) — coming back to a note you
  // had open a moment ago shows it instantly instead of blanking to the
  // skeleton below and re-fetching from zero.
  const { data: detail, error: notFound, mutate } = useSWR<NoteDetail>(`/api/notes/${params.noteId}`);
  const { data: courseData } = useSWR<{ course: { name: string } | null }>(
    detail ? `/api/courses/${detail.note.course_id}` : null
  );
  const courseName = courseData?.course?.name ?? null;
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [deleting, setDeleting] = useState(false);
  const editorRef = useRef<NoteEditorHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      body: JSON.stringify({ type: "note", id: Number(params.noteId) }),
    }).catch(() => {});
  }, [params.noteId]);

  useEffect(() => {
    if (highlight && detail) {
      editorRef.current?.scrollToHighlight(highlight);
    }
    // Runs once when this note's content first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.note.id]);

  function scheduleSave(fields: { title?: string; markdown?: string }) {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/notes/${params.noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
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
    await fetch(`/api/notes/${params.noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icon }),
    });
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${params.noteId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete note");
        return;
      }
      router.push(detail ? `/courses/${detail.note.course_id}` : "/");
    } finally {
      setDeleting(false);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Home
        </Link>
        <p className="text-sm text-muted-foreground">This note doesn&apos;t exist anymore.</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  return (
    // Full-bleed under the sticky header, Obsidian-style — escapes <main>'s
    // max-w-5xl/padding via the standard relative+negative-margin trick
    // (-my-6/sm:-my-8 exactly cancel main's own py-6/sm:py-8), then sizes
    // itself to fill the rest of the viewport so only the editor scrolls
    // internally instead of the whole page (the header stays put on its own
    // via `sticky`, see layout.tsx, rather than this height being load-
    // bearing for that — it's just here so nothing pushes past one screen).
    <div className="relative left-1/2 -mx-[50vw] -my-6 h-[calc(100dvh-3.5rem)] w-screen sm:-my-8">
      <div className="flex h-full flex-col gap-2 px-4 py-3 sm:px-8">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <Link
            href={`/courses/${detail.note.course_id}`}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {courseName ?? "Course"}
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </span>
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
                another note, recent activity, ...). */}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close note"
              onClick={() => router.push(`/courses/${detail.note.course_id}`)}
            >
              <X className="size-3.5 text-muted-foreground" />
            </Button>
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
            // px-1.5, not px-0 — flush against the icon read as cramped (a
            // 6px flex gap alone, at text-2xl) rather than intentionally
            // heading-like. bg-transparent dark:bg-transparent overrides the
            // base Input's own dark:bg-input/30 — without it this still
            // reads as a form field (a visible tinted box) rather than
            // plain heading text sitting on the page, dark mode especially.
            className="h-auto min-w-0 flex-1 border-none bg-transparent px-1.5 font-heading text-2xl font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder="Untitled"
          />
        </div>

        {/* No border/rounded box here on purpose — Obsidian's own note view
            has no visible card around the text either, just a thin
            border-b under its breadcrumb bar (see NoteEditor's own toolbar
            row) and then the page itself. A bordered container around this
            read as a widget embedded in the page rather than the page. */}
        <div className="min-h-0 flex-1">
          <NoteEditor ref={editorRef} value={markdown} onChange={handleMarkdownChange} />
        </div>

        {detail.backlinks.length > 0 && (
          <div className="max-h-32 shrink-0 space-y-1.5 overflow-y-auto rounded-xl border bg-muted/20 p-3">
            <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Link2 className="size-3.5" />
              {detail.backlinks.length} backlink{detail.backlinks.length === 1 ? "" : "s"}
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
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
