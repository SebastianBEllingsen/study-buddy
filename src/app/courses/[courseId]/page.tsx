"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ChevronRight,
  ClipboardPaste,
  ExternalLink,
  EyeOff,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  GripVertical,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  ListChecks,
  NotebookPen,
  Palette,
  Pencil,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  Upload,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  CanvasSummary,
  Course,
  DocumentSummaryRow,
  DueFlashcardItem,
  Folder,
  GeneratedItemSummary,
  GenerationMode,
  GenerationNotification,
  Note,
} from "@/lib/models";
import type { QuizGenerationSettings } from "@/lib/types";
import { parseFolderChipSettings, visibleFolderChips, type FolderChip, type FolderChipSettings } from "@/lib/folderChips";
import { setDragPayload, readDragPayload } from "@/lib/dragDrop";
import { useViewTransitionRouter } from "@/lib/useViewTransitionRouter";
import { useShowModelBadge } from "@/lib/useShowModelBadge";
import { useDocumentBadgeSettings } from "@/lib/useDocumentBadgeSettings";
import { useAiEnabled } from "@/lib/useAiEnabled";
import ModelBadge from "@/components/ModelBadge";
import { CustomizeCourseDialog } from "@/components/CustomizeCourseDialog";
import { FolderCustomizeFields } from "@/components/FolderCustomizeFields";
import { QuizGenerationDialog } from "@/components/QuizGenerationDialog";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import { HelpTooltip } from "@/components/HelpTooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import DocumentViewer, { type ViewedDocument } from "@/components/DocumentViewer";
import { CourseCanvasSection } from "@/components/canvas/CourseCanvasSection";
import { resizeImageToDataUrl } from "@/lib/resizeImage";
import { UPLOAD_ACCEPT, extensionOf, isImageExtension } from "@/lib/documentFormats";

interface CourseDetail {
  course: Course;
  folders: Folder[];
  documents: DocumentSummaryRow[];
  items: GeneratedItemSummary[];
  notes: Note[];
  canvases: CanvasSummary[];
}

const MODE_LABELS: Record<GenerationMode, string> = {
  notes: "Generate Notes",
  quiz: "Generate Quiz",
  flashcards: "Generate Flashcards",
};

// Distinct icon + accent per mode — quiet differentiation (a tinted bottom
// border on an otherwise plain outline button), not three loud buttons. The
// same icon/color reappears next to each generated item's title in
// GeneratedItemList, so a quiz set looks like a quiz set at a glance
// wherever it shows up on this page, not just on the generate buttons.
const MODE_META: Record<GenerationMode, { icon: LucideIcon; borderClass: string; textClass: string }> = {
  notes: { icon: NotebookPen, borderClass: "border-b-2 border-b-focus", textClass: "text-focus" },
  quiz: { icon: HelpCircle, borderClass: "border-b-2 border-b-amber", textClass: "text-amber" },
  flashcards: { icon: Layers, borderClass: "border-b-2 border-b-sage", textClass: "text-sage" },
};

const ALL_MATERIAL = "all";
const NEW_FOLDER_SENTINEL = "__new__";
// Stands in for filing something directly on the course page rather than
// inside any folder (folder_id null) — Select needs a string value, so this
// maps to `null` wherever it's read.
const COURSE_PAGE_SENTINEL = "__course__";
// Generation's "Save to" destination defaults to this — same behavior as
// before that control existed: file alongside the source folder when
// scoped to one, otherwise the course page itself (see generateForCourse's
// own destinationFolderId doc comment). Picking a real folder, the course
// page, or "+ Create new folder" below overrides it.
const AUTO_DESTINATION_SENTINEL = "__auto__";

// Folder-level key format is unchanged from before, so existing stored
// preferences keep working; a section suffix (e.g. "documents", "generated")
// namespaces the two sub-sections independently under the same folder.
// Pops a note into its own browser window — e.g. so it can sit next to this
// course page while browsing other material. Reuses the same window name
// per note rather than a fresh one each click, so clicking twice focuses the
// existing window instead of stacking duplicates — same convention as
// DocumentViewer's own Detach.
function detachNote(noteId: number) {
  window.open(`/vault/${noteId}/detached`, `study-buddy-note-${noteId}`, "noopener,width=900,height=1000");
}

function collapseKey(folderId: number, section?: string) {
  return section
    ? `studybuddy:folder:${folderId}:${section}:collapsed`
    : `studybuddy:folder:${folderId}:collapsed`;
}

function useCollapsed(key: string, defaultOpen = true) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultOpen : stored !== "1";
    } catch {
      return defaultOpen;
    }
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    try {
      localStorage.setItem(key, next ? "0" : "1");
    } catch {
      // localStorage unavailable (private browsing, etc.) — harmless degradation.
    }
  }

  return [open, onOpenChange] as const;
}

// Documents and generated items previously deleted on a single unconfirmed
// click — unlike courses/folders, which already confirm. Both represent
// real, possibly hours-of-work content (a generated quiz/flashcard set, an
// uploaded PDF), so they get the same confirm-before-delete treatment here.
function DeleteRowButton({
  itemLabel,
  ariaLabel,
  onConfirm,
}: {
  itemLabel: string;
  ariaLabel: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={ariaLabel}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <Trash2 className="size-3.5 text-muted-foreground" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {itemLabel}?</AlertDialogTitle>
          <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleConfirm}>
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function FolderSelect({
  folders,
  value,
  onChange,
  ariaLabel,
}: {
  folders: Folder[];
  value: number | null;
  onChange: (folderId: number | null) => void;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value === null ? COURSE_PAGE_SENTINEL : String(value)}
      onValueChange={(v) => {
        if (!v) return;
        onChange(v === COURSE_PAGE_SENTINEL ? null : Number(v));
      }}
    >
      <SelectTrigger size="sm" aria-label={ariaLabel}>
        <SelectValue>
          {(v: string) =>
            v === COURSE_PAGE_SENTINEL ? "This course page" : (folders.find((f) => String(f.id) === v)?.name ?? v)
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={COURSE_PAGE_SENTINEL}>This course page</SelectItem>
        {folders.map((folder) => (
          <SelectItem key={folder.id} value={String(folder.id)}>
            {folder.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Lets generation source from an exact, hand-picked set of documents instead
// of a whole folder — independent of folder boundaries, so a pick can span
// several. Draft state so Cancel discards changes; only Apply commits back
// to the Practice card's own selection.
function DocumentPickerDialog({
  open,
  onOpenChange,
  documents,
  folders,
  selected,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: DocumentSummaryRow[];
  folders: Folder[];
  selected: Set<number>;
  onApply: (ids: Set<number>) => void;
}) {
  const [draft, setDraft] = useState<Set<number>>(selected);
  // Re-seeds the draft from the committed selection each time the dialog
  // opens — render-phase sync (see FolderCard's own seededFor-style guards
  // elsewhere in this app) rather than a useEffect.
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setDraft(new Set(selected));
    setSeeded(true);
  } else if (!open && seeded) {
    setSeeded(false);
  }

  function toggle(id: number) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const byFolder = new Map<number | null, DocumentSummaryRow[]>();
  for (const doc of documents) {
    const list = byFolder.get(doc.folder_id) ?? [];
    list.push(doc);
    byFolder.set(doc.folder_id, list);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose documents</DialogTitle>
          <DialogDescription>
            Generate from exactly these, regardless of which folder each is filed in.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents in this course yet.</p>
          ) : (
            [...byFolder.entries()].map(([folderId, docs]) => (
              <div key={String(folderId)} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {folderId === null ? "This course page" : (folders.find((f) => f.id === folderId)?.name ?? "This course page")}
                </p>
                {docs.map((doc) => (
                  <label
                    key={doc.id}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                      doc.status === "extracted" ? "cursor-pointer hover:bg-muted" : "opacity-50"
                    }`}
                  >
                    <Checkbox
                      checked={draft.has(doc.id)}
                      disabled={doc.status !== "extracted"}
                      onCheckedChange={() => toggle(doc.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{doc.filename}</span>
                    {doc.status !== "extracted" && (
                      <span className="shrink-0 text-xs text-muted-foreground">{doc.status}</span>
                    )}
                  </label>
                ))}
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={draft.size === 0}
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Use {draft.size} document{draft.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentList({
  documents,
  folderId,
  editMode,
  selected,
  onToggleSelect,
  onDelete,
  onRename,
  onView,
  onReorder,
}: {
  documents: DocumentSummaryRow[];
  folderId: number | null;
  editMode: boolean;
  selected: Set<number>;
  onToggleSelect: (documentId: number) => void;
  onDelete: (documentId: number) => void;
  onRename: (documentId: number, filename: string) => void;
  onView: (doc: DocumentSummaryRow) => void;
  onReorder: (folderId: number | null, orderedIds: number[]) => void;
}) {
  // A single renamingId (not one useState per row) — only one document's
  // name can be in edit mode at a time, same shape as ChatContent's
  // deleteTargetId elsewhere in this app.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const documentBadges = useDocumentBadgeSettings();

  function startRename(doc: DocumentSummaryRow) {
    setRenamingId(doc.id);
    setNameDraft(doc.filename);
  }

  function commitRename(doc: DocumentSummaryRow) {
    setRenamingId(null);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === doc.filename) return;
    onRename(doc.id, trimmed);
  }

  // Drops a dragged document (payload set by its own onDragStart below) onto
  // another document in this same list to reorder — reusing the existing
  // "drag a document" payload that the folder cards already read to move a
  // document between folders, just handled here at the row level instead.
  function handleDrop(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    // Without this, the drop also bubbles to the folder card's own onDrop
    // (which moves a dropped document into that folder) — since this row is
    // already inside the target folder, that second handler ran too and
    // re-appended the document to the end, undoing the reorder that just
    // happened right after it.
    e.stopPropagation();
    const payload = readDragPayload(e);
    if (payload?.kind !== "document" || payload.id === targetId) return;
    const ids = documents.map((d) => d.id);
    const from = ids.indexOf(payload.id);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, payload.id);
    onReorder(folderId, ids);
  }

  return (
    <>
      {documents.map((doc) => (
        <li
          key={doc.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, doc.id)}
          className="group/row flex items-center justify-between gap-2 px-1 py-2 text-sm hover:bg-muted/40"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {editMode && (
              <Checkbox
                checked={selected.has(doc.id)}
                onCheckedChange={() => onToggleSelect(doc.id)}
                aria-label={`Select ${doc.filename}`}
              />
            )}
            {/* Drag source is this handle — grip icon, filename, and status
                badge — not the whole row. Mirrors FolderCard's own grip div
                (icon + name + meta counts together, action buttons kept
                outside it) for a consistent drag ghost/feel; the row's
                folder-move dropdown and delete button stay outside this
                handle, since including those in the draggable area is what
                broke native drag initiation in the first place. */}
            <div
              draggable
              onDragStart={(e) => setDragPayload(e, { kind: "document", id: doc.id })}
              className="flex min-w-0 cursor-grab select-none items-center gap-1.5 active:cursor-grabbing"
            >
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover/row:text-muted-foreground" />
              {isImageExtension(extensionOf(doc.filename)) ? (
                <ImageIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground/70" />
              )}
              {renamingId === doc.id ? (
                <Input
                  autoFocus
                  value={nameDraft}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => commitRename(doc)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename(doc);
                    }
                    if (e.key === "Escape") {
                      setNameDraft(doc.filename);
                      setRenamingId(null);
                    }
                  }}
                  className="h-6 max-w-60"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onView(doc)}
                  className="break-words text-left hover:underline"
                >
                  {doc.filename}
                </button>
              )}
              {documentBadges.enabled && doc.status === "pending" && (
                <Badge variant="secondary" className="ml-1">
                  processing…
                </Badge>
              )}
              {documentBadges.enabled && doc.status === "extracted" && (
                <Badge className="ml-1 border-sage/30 bg-sage/10 text-sage" variant="outline">
                  {documentBadges.detail === "minimal" ? `${doc.page_count}p` : `extracted, ${doc.page_count}p`}
                </Badge>
              )}
              {documentBadges.enabled && doc.status === "failed" && (
                <Badge variant="destructive" className="ml-1">
                  {doc.error_message}
                </Badge>
              )}
              {documentBadges.enabled && doc.status === "image" && (
                <Badge variant="secondary" className="ml-1">
                  {documentBadges.detail === "minimal" ? "image" : "image, not used for generation"}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {renamingId !== doc.id && (
              <RowActionsMenu
                ariaLabel={`Actions for ${doc.filename}`}
                actions={[{ label: "Rename", icon: Pencil, onSelect: () => startRename(doc) }]}
                deleteLabel="Delete document"
                onDelete={() => onDelete(doc.id)}
              />
            )}
          </div>
        </li>
      ))}
    </>
  );
}

function GeneratedItemList({
  items,
  folderId,
  dueByItemId,
  notifiedItemIds,
  editMode,
  selected,
  onToggleSelect,
  onDelete,
  onReorder,
}: {
  items: GeneratedItemSummary[];
  folderId: number | null;
  dueByItemId: Map<number, number>;
  notifiedItemIds: Set<number>;
  editMode: boolean;
  selected: Set<number>;
  onToggleSelect: (itemId: number) => void;
  onDelete: (itemId: number) => void;
  onReorder: (folderId: number | null, orderedIds: number[]) => void;
}) {
  const { push: pushWithTransition } = useViewTransitionRouter();
  const modelBadge = useShowModelBadge();

  // See DocumentList's handleDrop — same reorder-by-drop-on-a-sibling-row
  // pattern (including why stopPropagation matters), mirrored here for
  // generated items.
  function handleDrop(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    e.stopPropagation();
    const payload = readDragPayload(e);
    if (payload?.kind !== "item" || payload.id === targetId) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(payload.id);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, payload.id);
    onReorder(folderId, ids);
  }

  return (
    <>
      {items.map((item) => {
        const ModeIcon = MODE_META[item.mode].icon;
        return (
        <li
          key={item.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, item.id)}
          className="group/row flex items-center justify-between gap-2 px-1 py-2 text-sm hover:bg-muted/40"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {editMode && (
              <Checkbox
                checked={selected.has(item.id)}
                onCheckedChange={() => onToggleSelect(item.id)}
                aria-label={`Select ${item.title}`}
              />
            )}
            {/* Drag source is this handle — grip icon, title, badge, and
                date together — not the whole row. See DocumentList's row for
                why (mirrors FolderCard's own grip div; the row's
                folder-move dropdown and delete button stay outside it). */}
            <div
              draggable
              onDragStart={(e) => setDragPayload(e, { kind: "item", id: item.id })}
              className="flex min-w-0 cursor-grab select-none items-center gap-1.5 active:cursor-grabbing"
            >
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover/row:text-muted-foreground" />
              <ModeIcon className={`size-3.5 shrink-0 ${MODE_META[item.mode].textClass}`} />
              <Link
                href={`/items/${item.id}`}
                // Anchors are natively draggable by default — without this,
                // a drag starting directly over the title text drags the
                // link itself (browsers' own "drag this link" gesture)
                // instead of reordering the row via this handle's draggable.
                draggable={false}
                className="truncate hover:underline"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  pushWithTransition(`/items/${item.id}`);
                }}
              >
                {item.title}
              </Link>
              {modelBadge.show && <ModelBadge info={item} detail={modelBadge.detail} />}
              {!!dueByItemId.get(item.id) && (
                <span className="shrink-0 rounded-full bg-amber/15 px-1.5 py-0.5 text-xs font-medium text-amber">
                  {dueByItemId.get(item.id)} due
                </span>
              )}
              {notifiedItemIds.has(item.id) && (
                // Same dot, same color, as the one on this course's card on
                // the home page — this is specifically what that dot was
                // referencing, so it reads as the same notification, not a
                // second unrelated one.
                <span
                  aria-label="New — not yet opened"
                  title="New — not yet opened"
                  className="size-2 shrink-0 rounded-full bg-focus"
                />
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <DeleteRowButton
              itemLabel={item.title}
              ariaLabel={`Delete ${item.title}`}
              onConfirm={() => onDelete(item.id)}
            />
          </div>
        </li>
        );
      })}
    </>
  );
}

function NoteList({
  notes,
  folderId,
  folders,
  onMove,
  onDelete,
  onReorder,
}: {
  notes: Note[];
  folderId: number | null;
  folders: Folder[];
  onMove: (noteId: number, folderId: number | null) => void;
  onDelete: (noteId: number) => void;
  onReorder: (folderId: number | null, orderedIds: number[]) => void;
}) {
  // Same reorder-by-drop-on-a-sibling-row pattern as DocumentList/
  // GeneratedItemList's row-level handleDrop.
  function handleDrop(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    e.stopPropagation();
    const payload = readDragPayload(e);
    if (payload?.kind !== "note" || payload.id === targetId) return;
    const ids = notes.map((n) => n.id);
    const from = ids.indexOf(payload.id);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, payload.id);
    onReorder(folderId, ids);
  }

  return (
    <>
      {notes.map((note) => (
        <li
          key={note.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, note.id)}
          className="group/row flex items-center justify-between gap-2 px-1 py-2 text-sm hover:bg-muted/40"
        >
          <div
            draggable
            onDragStart={(e) => setDragPayload(e, { kind: "note", id: note.id })}
            className="flex min-w-0 cursor-grab select-none items-center gap-1.5 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover/row:text-muted-foreground" />
            {note.icon ? (
              <span className="shrink-0 text-sm leading-none">{note.icon}</span>
            ) : (
              <StickyNote className="size-3.5 shrink-0 text-sage/70" />
            )}
            <Link
              href={`/vault/${note.id}`}
              draggable={false}
              className="truncate hover:underline"
            >
              {note.title}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(note.updated_at.replace(" ", "T") + "Z").toLocaleDateString()}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${note.title} in a new window`}
              onClick={() => detachNote(note.id)}
            >
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </Button>
            <RowActionsMenu
              ariaLabel={`Actions for ${note.title}`}
              deleteLabel="Delete note"
              onDelete={() => onDelete(note.id)}
            >
              <div className="space-y-1.5 p-1.5">
                <p className="text-xs font-medium text-muted-foreground">Move to</p>
                <FolderSelect
                  folders={folders}
                  value={note.folder_id}
                  onChange={(folderId) => onMove(note.id, folderId)}
                  ariaLabel={`Move ${note.title} to folder`}
                />
              </div>
            </RowActionsMenu>
          </div>
        </li>
      ))}
    </>
  );
}

function FolderCard({
  folder,
  folders,
  docsByFolder,
  itemsByFolder,
  notesByFolder,
  dueByItemId,
  notifiedItemIds,
  editMode,
  selectedDocs,
  selectedItems,
  onToggleSelectDoc,
  onToggleSelectItem,
  onUpload,
  onDeleteDocument,
  onMoveDocument,
  onRenameDocument,
  onViewDocument,
  onMoveItem,
  onDeleteItem,
  onMoveNote,
  onDeleteNote,
  onReorderNotes,
  onAddToFolder,
  onDeleteFolder,
  onRenameFolder,
  onCustomizeFolder,
  onReorder,
  onReorderDocuments,
  onReorderItems,
  onNest,
  onCreateSubfolder,
  chips,
  isSubfolder = false,
}: {
  folder: Folder;
  folders: Folder[];
  docsByFolder: (folderId: number) => DocumentSummaryRow[];
  itemsByFolder: (folderId: number) => GeneratedItemSummary[];
  notesByFolder: (folderId: number) => Note[];
  dueByItemId: Map<number, number>;
  notifiedItemIds: Set<number>;
  editMode: boolean;
  selectedDocs: Set<number>;
  selectedItems: Set<number>;
  onToggleSelectDoc: (documentId: number) => void;
  onToggleSelectItem: (itemId: number) => void;
  onUpload: (folderId: number, files: FileList) => Promise<void>;
  onDeleteDocument: (documentId: number) => void;
  onMoveDocument: (documentId: number, folderId: number | null) => void;
  onRenameDocument: (documentId: number, filename: string) => void;
  onViewDocument: (doc: DocumentSummaryRow) => void;
  onMoveItem: (itemId: number, folderId: number | null) => void;
  onDeleteItem: (itemId: number) => void;
  onMoveNote: (noteId: number, folderId: number | null) => void;
  onDeleteNote: (noteId: number) => void;
  onReorderNotes: (folderId: number | null, orderedIds: number[]) => void;
  onAddToFolder: (folderId: number, kind: "upload" | "note") => void;
  onDeleteFolder: (folderId: number) => Promise<void>;
  onRenameFolder: (folderId: number, name: string) => Promise<void>;
  onCustomizeFolder: (folderId: number, fields: { icon?: string | null; color?: string | null }) => void;
  onReorder: (draggedFolderId: number, targetFolderId: number) => void;
  onReorderDocuments: (folderId: number | null, orderedIds: number[]) => void;
  onReorderItems: (folderId: number | null, orderedIds: number[]) => void;
  onNest: (draggedFolderId: number, parentFolderId: number) => void;
  onCreateSubfolder: (parentFolderId: number) => void;
  // Which count tags to show after the name — see lib/folderChips.ts.
  chips: Set<FolderChip>;
  // True for a folder rendered inside its parent's card — hides subfolder-
  // only actions (nesting, "+ Subfolder") since nesting is one level deep.
  isSubfolder?: boolean;
}) {
  const [open, onOpenChange] = useCollapsed(collapseKey(folder.id));
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(folder.name);
  const [dragOver, setDragOver] = useState(false);
  // Separate hover state for the name/icon drop zone specifically — see
  // handleNameAreaDragOver/handleNameAreaDrop below.
  const [nameDragOver, setNameDragOver] = useState(false);

  const documents = docsByFolder(folder.id);
  const items = itemsByFolder(folder.id);
  const notes = notesByFolder(folder.id);
  const subfolders = isSubfolder
    ? []
    : folders.filter((f) => f.parent_folder_id === folder.id);

  // A pending "just generated" notification for an item filed directly in
  // this folder — or, one level down, in one of its subfolders (subfolders
  // render inside THIS card's own CollapsibleContent, so their content
  // never even mounts, notification and all, while this card is collapsed).
  const hasNotifiedHere = items.some((item) => notifiedItemIds.has(item.id));
  const hasNotifiedSubtree =
    hasNotifiedHere ||
    subfolders.some((sub) => itemsByFolder(sub.id).some((item) => notifiedItemIds.has(item.id)));

  // Force this card open the moment its subtree has something to show for —
  // same "don't fight a manual re-collapse afterward" rule as
  // CollapsibleSection's own autoOpen.
  useEffect(() => {
    if (hasNotifiedSubtree) onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNotifiedSubtree]);

  async function commitRename() {
    const trimmed = nameDraft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === folder.name) {
      setNameDraft(folder.name);
      return;
    }
    await onRenameFolder(folder.id, trimmed);
  }

  // Dropping anywhere on the card reorders — except the name/icon area
  // (handleNameAreaDragOver/handleNameAreaDrop below), which is a smaller,
  // deliberate target for nesting instead, so the two gestures don't
  // compete for the same drop zone.
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    // Without this, a drop on a SUBFOLDER's card also bubbles to its
    // parent folder's own identical onDrop (subfolders render nested
    // inside their parent's <Card>) — the parent's handler then reprocesses
    // the same drop against itself, silently moving the item into the
    // parent instead of the subfolder, or uploading a dropped file twice
    // (once per folder). Same fix already applied to DocumentList/
    // GeneratedItemList's row-level handleDrop above.
    e.stopPropagation();
    setDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await onUpload(folder.id, e.dataTransfer.files);
      return;
    }
    const payload = readDragPayload(e);
    if (!payload) return;
    if (payload.kind === "document") onMoveDocument(payload.id, folder.id);
    else if (payload.kind === "item") onMoveItem(payload.id, folder.id);
    else if (payload.kind === "note") onMoveNote(payload.id, folder.id);
    else if (payload.kind === "folder" && payload.id !== folder.id) onReorder(payload.id, folder.id);
  }

  // The name/icon area is a dedicated "drop inside this folder" target —
  // stops propagation so the card's own reorder handler above doesn't also
  // fire while hovering/dropping directly on it, but only when it's
  // actually consuming the drop as a nest; anything else (wrong payload
  // kind, or this card isn't a valid nest target) is left to bubble up to
  // the card's normal handler so document/item moves and folder reordering
  // still work when dropped here too.
  function handleNameAreaDragOver(e: React.DragEvent) {
    if (isSubfolder) return;
    e.preventDefault();
    e.stopPropagation();
    setNameDragOver(true);
  }

  function handleNameAreaDrop(e: React.DragEvent) {
    if (isSubfolder) return;
    const payload = readDragPayload(e);
    if (
      payload?.kind === "folder" &&
      payload.id !== folder.id &&
      !folders.some((f) => f.parent_folder_id === payload.id)
    ) {
      e.preventDefault();
      e.stopPropagation();
      setNameDragOver(false);
      onNest(payload.id, folder.id);
      return;
    }
    setNameDragOver(false);
  }

  return (
    <div
      className={`group rounded-md transition-colors ${dragOver ? "bg-primary/5 ring-1 ring-primary" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="rounded-md px-2 py-1.5 hover:bg-muted/40">
          <div className="flex items-center justify-between gap-2">
            <div
              draggable
              onDragStart={(e) => setDragPayload(e, { kind: "folder", id: folder.id })}
              // See DocumentList's row for why: this wraps the folder name
              // text, so without select-none a drag starting there risks
              // being hijacked by native text selection instead.
              className="flex min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 active:cursor-grabbing"
            >
              {/* Quiet by default, full-strength on hover/focus of the card —
                  the handle stays discoverable without competing with the
                  folder name for attention every time you just glance at
                  the list. */}
              <GripVertical className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground" />
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium">
                <ChevronRight
                  className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                />
                <span
                  className={`flex min-w-0 items-center gap-2 rounded transition-colors ${
                    nameDragOver ? "bg-primary/15 ring-1 ring-primary" : ""
                  }`}
                  onDragOver={handleNameAreaDragOver}
                  onDragLeave={() => setNameDragOver(false)}
                  onDrop={handleNameAreaDrop}
                >
                  {/* A background tint is the only way an accent color
                      shows up when the icon is an emoji — CSS `color`
                      doesn't affect emoji glyphs the way it does the
                      lucide FolderIcon, so the tint has to live behind
                      whichever one is showing, not on the glyph itself. */}
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded-md"
                    style={folder.color ? { backgroundColor: `${folder.color}26` } : undefined}
                  >
                    {folder.icon ? (
                      <span className="text-sm leading-none">{folder.icon}</span>
                    ) : (
                      <FolderIcon
                        className={`size-4 ${folder.color ? "" : "text-muted-foreground"}`}
                        style={folder.color ? { color: folder.color } : undefined}
                      />
                    )}
                  </span>
                  {renaming ? (
                    <Input
                      autoFocus
                      value={nameDraft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") {
                          setNameDraft(folder.name);
                          setRenaming(false);
                        }
                      }}
                      className="h-6 max-w-40"
                    />
                  ) : (
                    <span className="truncate font-semibold">{folder.name}</span>
                  )}
                </span>
                {/* Icon+count chips instead of "N docs, N generated, N
                    notes" — same colors as the type icons in the merged
                    list below, so the header alone tells you what's
                    actually in here at a glance. Native title attributes
                    keep the full word one hover away. */}
                {chips.size > 0 && (
                  <span className="flex shrink-0 items-center gap-2.5 font-normal text-xs">
                    {chips.has("documents") && (
                      <span
                        className="flex items-center gap-1 text-muted-foreground"
                        title={`${documents.length} document${documents.length === 1 ? "" : "s"}`}
                      >
                        <FileText className="size-3 shrink-0" />
                        {documents.length}
                      </span>
                    )}
                    {chips.has("generated") && (
                      <span className="flex items-center gap-1 text-focus/80" title={`${items.length} generated`}>
                        <Sparkles className="size-3 shrink-0" />
                        {items.length}
                      </span>
                    )}
                    {chips.has("notes") && (
                      <span
                        className="flex items-center gap-1 text-sage/80"
                        title={`${notes.length} note${notes.length === 1 ? "" : "s"}`}
                      >
                        <StickyNote className="size-3 shrink-0" />
                        {notes.length}
                      </span>
                    )}
                    {chips.has("subfolders") && subfolders.length > 0 && (
                      <span
                        className="flex items-center gap-1 text-muted-foreground"
                        title={`${subfolders.length} subfolder${subfolders.length === 1 ? "" : "s"}`}
                      >
                        <FolderIcon className="size-3 shrink-0" />
                        {subfolders.length}
                      </span>
                    )}
                  </span>
                )}
              </CollapsibleTrigger>
            </div>
            <div className="flex shrink-0 items-center">
              {!renaming && (
                <RowActionsMenu
                  ariaLabel={`Add to ${folder.name}`}
                  triggerIcon={Plus}
                  actions={[
                    { label: "Upload files", icon: Upload, onSelect: () => onAddToFolder(folder.id, "upload") },
                    { label: "Import Anki deck", icon: Layers, onSelect: () => onAddToFolder(folder.id, "upload") },
                    { label: "New note", icon: StickyNote, onSelect: () => onAddToFolder(folder.id, "note") },
                    // Nesting is one level deep — a subfolder can't have its
                    // own subfolder, so this option only shows up top-level.
                    ...(isSubfolder
                      ? []
                      : [{ label: "New subfolder", icon: FolderPlus, onSelect: () => onCreateSubfolder(folder.id) }]),
                  ]}
                />
              )}
              {!renaming && (
                <RowActionsMenu
                  ariaLabel={`Actions for ${folder.name}`}
                  contentClassName="w-64"
                  actions={[{ label: "Rename", icon: Pencil, onSelect: () => setRenaming(true) }]}
                  deleteLabel="Delete folder"
                  deleteDescription="Its contents (and any subfolders' contents) aren't deleted — they move to the course page instead."
                  onDelete={() => onDeleteFolder(folder.id)}
                >
                  <FolderCustomizeFields folder={folder} onCustomize={onCustomizeFolder} />
                </RowActionsMenu>
              )}
            </div>
          </div>
        </div>
        <CollapsibleContent>
          <div className="space-y-2 py-1 pl-[1.625rem]">
            {documents.length + items.length + notes.length + subfolders.length === 0 ? (
              <p className="py-0.5 text-sm text-muted-foreground/70">
                Nothing here yet — upload a document, generate something, or add a note.
              </p>
            ) : (
              // One merged list instead of three always-expanded Documents/
              // Generated/Notes sections — each row's own icon (FileText,
              // the generated item's mode icon, StickyNote) still says what
              // it is, so nothing here needs a section header to explain it,
              // and a folder with just one note no longer costs two empty
              // "nothing here yet" lines above it.
              <ul className="divide-y divide-border/60">
                {documents.length > 0 && (
                  <DocumentList
                    documents={documents}
                    folderId={folder.id}
                    editMode={editMode}
                    selected={selectedDocs}
                    onToggleSelect={onToggleSelectDoc}
                    onDelete={onDeleteDocument}
                    onRename={onRenameDocument}
                    onView={onViewDocument}
                    onReorder={onReorderDocuments}
                  />
                )}
                {items.length > 0 && (
                  <GeneratedItemList
                    items={items}
                    folderId={folder.id}
                    dueByItemId={dueByItemId}
                    notifiedItemIds={notifiedItemIds}
                    editMode={editMode}
                    selected={selectedItems}
                    onToggleSelect={onToggleSelectItem}
                    onDelete={onDeleteItem}
                    onReorder={onReorderItems}
                  />
                )}
                {notes.length > 0 && (
                  <NoteList
                    notes={notes}
                    folderId={folder.id}
                    folders={folders}
                    onMove={onMoveNote}
                    onDelete={onDeleteNote}
                    onReorder={onReorderNotes}
                  />
                )}
              </ul>
            )}
            {subfolders.length > 0 && (
              <div className="space-y-1 border-l border-muted-foreground/15 pl-4">
                {subfolders.map((sub) => (
                  <FolderCard
                    key={sub.id}
                    folder={sub}
                    folders={folders}
                    docsByFolder={docsByFolder}
                    itemsByFolder={itemsByFolder}
                    notesByFolder={notesByFolder}
                    dueByItemId={dueByItemId}
                    notifiedItemIds={notifiedItemIds}
                    editMode={editMode}
                    selectedDocs={selectedDocs}
                    selectedItems={selectedItems}
                    onToggleSelectDoc={onToggleSelectDoc}
                    onToggleSelectItem={onToggleSelectItem}
                    onUpload={onUpload}
                    onDeleteDocument={onDeleteDocument}
                    onMoveDocument={onMoveDocument}
                    onRenameDocument={onRenameDocument}
                    onViewDocument={onViewDocument}
                    onMoveItem={onMoveItem}
                    onDeleteItem={onDeleteItem}
                    onMoveNote={onMoveNote}
                    onDeleteNote={onDeleteNote}
                    onReorderNotes={onReorderNotes}
                    onAddToFolder={onAddToFolder}
                    onDeleteFolder={onDeleteFolder}
                    onRenameFolder={onRenameFolder}
                    onCustomizeFolder={onCustomizeFolder}
                    onReorder={onReorder}
                    onReorderDocuments={onReorderDocuments}
                    onReorderItems={onReorderItems}
                    onNest={onNest}
                    onCreateSubfolder={onCreateSubfolder}
                    chips={chips}
                    isSubfolder
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function BulkActionBar({
  count,
  folders,
  onMove,
  onDelete,
  onClear,
}: {
  count: number;
  folders: Folder[];
  onMove: (folderId: number | null) => Promise<void>;
  onDelete: () => Promise<void>;
  onClear: () => void;
}) {
  const [moveTo, setMoveTo] = useState<string>(COURSE_PAGE_SENTINEL);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleMoveClick() {
    setBusy(true);
    try {
      await onMove(moveTo === COURSE_PAGE_SENTINEL ? null : Number(moveTo));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteConfirm() {
    setBusy(true);
    try {
      await onDelete();
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-md">
      <span className="px-1 text-sm font-medium">{count} selected</span>
      <FolderSelect
        folders={folders}
        value={moveTo === COURSE_PAGE_SENTINEL ? null : Number(moveTo)}
        onChange={(id) => setMoveTo(id === null ? COURSE_PAGE_SENTINEL : String(id))}
        ariaLabel="Move selected to folder"
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={handleMoveClick}>
        Move
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger render={<Button size="sm" variant="destructive" disabled={busy} />}>
          <Trash2 />
          Delete
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count} item{count === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the selected documents and generated items permanently — this can&apos;t
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={handleDeleteConfirm}>
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto">
        <X />
        Clear
      </Button>
    </div>
  );
}

export default function CoursePage() {
  const params = useParams<{ courseId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = params.courseId;

  // Cached across navigation (see SWRProvider) — leaving this course and
  // coming back shows it instantly instead of blanking to the skeleton
  // below and re-fetching everything from zero.
  const { data: detail, error: notFound, mutate: refresh } = useSWR<CourseDetail>(
    `/api/courses/${courseId}`
  );
  // The home dashboard's due-cards badge on this course's card is computed
  // from the same site-wide due list — fetching it here too (rather than a
  // course-scoped endpoint) guarantees this page always agrees with exactly
  // what triggered that badge, instead of two separate "due" computations
  // drifting apart.
  const { data: statsData, mutate: mutateStats } = useSWR<{
    dueFlashcards: { items: DueFlashcardItem[] };
    generationNotifications: GenerationNotification[];
  }>("/api/stats");
  const dueItems = useMemo(
    () => (statsData?.dueFlashcards.items ?? []).filter((item) => item.courseId === Number(courseId)),
    [statsData, courseId]
  );
  // Pending "just generated" notifications for this course — only ever
  // non-empty when Settings' "jump to newly generated content
  // automatically" is off (see handleGenerate and the generate route).
  // Backed by the shared /api/stats cache (see mutateStats below) rather
  // than its own local state, so dismissing one here is instantly reflected
  // in the home dashboard's dot too, the moment you navigate back — no
  // separate state to fall out of sync with it.
  const notifications = useMemo(
    () => (statsData?.generationNotifications ?? []).filter((n) => n.courseId === Number(courseId)),
    [statsData, courseId]
  );
  const { data: settingsData } = useSWR<{ autoOpenGeneratedItems: boolean; folderChips: FolderChipSettings }>(
    "/api/settings"
  );

  // A course with its own page backdrop keeps it: flag it on <html> so the
  // app wallpaper (components/AppWallpaper.tsx) steps aside on this page.
  const hasOwnBackdrop = !!detail?.course.page_background_image;
  useEffect(() => {
    if (!hasOwnBackdrop) return;
    const root = document.documentElement;
    root.setAttribute("data-page-backdrop", "");
    return () => root.removeAttribute("data-page-backdrop");
  }, [hasOwnBackdrop]);
  const autoOpenGeneratedItems = settingsData?.autoOpenGeneratedItems ?? true;
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  // Set when the dialog is opened via a folder's "+ Subfolder" action
  // rather than the top-level "New folder" button — null means top-level.
  const [newFolderParentId, setNewFolderParentId] = useState<number | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDestination, setUploadDestination] = useState<string>("");
  const [uploadNewFolderName, setUploadNewFolderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  // Shares uploadDestination/uploadNewFolderName with Upload/Paste above —
  // one top-level dialog instead of a "New note title…" row repeated inside
  // every folder (that got noisy fast once a course had more than a couple
  // of folders — see FolderCard's own "+" menu for the folder-scoped way in).
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [creatingNote, setCreatingNote] = useState(false);

  // Shares uploadDestination/uploadNewFolderName with the upload dialog —
  // both pick a destination folder the same way, and only one dialog is
  // open at a time.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  // Document: scoped into notes/quiz/flashcard generation and full-text
  // search, like an uploaded PDF. Note: opened straight into the wiki-style
  // note editor instead — not picked up as generation source material,
  // since generation reads from documents only (see generate/[mode]/route.ts).
  const [pasteSaveAs, setPasteSaveAs] = useState<"document" | "note">("document");
  const [pasting, setPasting] = useState(false);
  const [tidyingPaste, setTidyingPaste] = useState(false);
  const [insertingImage, setInsertingImage] = useState(false);
  const [pasteDropActive, setPasteDropActive] = useState(false);

  const aiEnabled = useAiEnabled();
  const [generating, setGenerating] = useState<GenerationMode | null>(null);
  const [scope, setScope] = useState<string>(ALL_MATERIAL);
  // A hand-picked document selection (see DocumentPickerDialog) takes over
  // from `scope` above whenever it's non-empty — the two are mutually
  // exclusive ways of answering the same "From" question, not a folder plus
  // extra documents on top of it.
  const [generationDocIds, setGenerationDocIds] = useState<Set<number>>(new Set());
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  // Where to file the generated item — independent of `scope`/
  // `generationDocIds` above, which only pick the source material. Same
  // sentinel pattern as uploadDestination (see AUTO_DESTINATION_SENTINEL,
  // COURSE_PAGE_SENTINEL, NEW_FOLDER_SENTINEL).
  const [generationDestination, setGenerationDestination] = useState<string>(AUTO_DESTINATION_SENTINEL);
  const [generationNewFolderName, setGenerationNewFolderName] = useState("");
  const [quizDialogOpen, setQuizDialogOpen] = useState(false);
  // Collapsed by default — the folders above are the main event; this is a
  // secondary action tucked behind its own small trigger rather than a
  // full card competing for attention every time the page loads.
  const [practiceOpen, setPracticeOpen] = useCollapsed(`studybuddy:course:${courseId}:practice:collapsed`, false);
  const [error, setError] = useState<string | null>(null);

  const [customizeOpen, setCustomizeOpen] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<number>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  function toggleSelectDoc(id: number) {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectItem(id: number) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedDocs(new Set());
    setSelectedItems(new Set());
  }

  function toggleEditMode() {
    setEditMode((prev) => !prev);
    clearSelection();
  }

  // Seeds the upload-destination dropdown to the course page itself the
  // first time detail loads — render-phase sync (see CustomizeCourseDialog's
  // seededFor) rather than a useEffect; the `!uploadDestination` guard makes
  // this a no-op on every later update, so the dropdown always has a valid,
  // selected option.
  if (detail && !uploadDestination) {
    setUploadDestination(COURSE_PAGE_SENTINEL);
  }

  // itemId → how many of its cards are due — GeneratedItemList and the
  // banner below both key off this so a set's "N due" badge always matches
  // the count behind the home page's dot on this course's card.
  const dueByItemId = useMemo(() => new Map(dueItems.map((item) => [item.itemId, item.dueCount])), [dueItems]);
  const notifiedItemIds = useMemo(() => new Set(notifications.map((n) => n.itemId)), [notifications]);

  // Shared by the popup's own dismiss button, the course page's inline "x",
  // and (via the API route) opening the item itself — see
  // dismissGenerationNotification for why calling this more than once for
  // the same item is harmless. Updates the shared /api/stats cache entry
  // directly (rather than local state) so the home dashboard's dot for this
  // course reflects the dismissal the instant you navigate back to it.
  function dismissNotification(itemId: number) {
    mutateStats(
      (prev) =>
        prev && {
          ...prev,
          generationNotifications: prev.generationNotifications.filter((n) => n.itemId !== itemId),
        },
      { revalidate: false }
    );
    fetch(`/api/generation-notifications/${itemId}`, { method: "DELETE" }).catch(() => {});
  }

  // The ?document=<id> query param is the source of truth for which
  // document's viewer is open — SearchDialog.tsx navigates straight to it
  // for document matches (there's no dedicated document page to link to),
  // and it also means opening a document is refresh/back-button friendly.
  // No local state/effect needed: derived fresh from the URL every render.
  const viewingDocumentId = (() => {
    const idParam = searchParams.get("document");
    return idParam ? Number(idParam) : null;
  })();

  // Fetched fresh rather than read off detail.documents (the course-wide
  // list, which deliberately leaves extracted_text out — see
  // listDocumentSummariesForCourse — so opening one document doesn't cost
  // pulling every document's full extracted text on every course-page
  // load). Same endpoint the detached document view
  // (app/documents/[documentId]/view) already uses for exactly this. Must
  // stay above the !detail early returns below (Rules of Hooks).
  const { data: viewingDocumentData } = useSWR<{ document: ViewedDocument }>(
    viewingDocumentId !== null ? `/api/documents/${viewingDocumentId}` : null
  );

  // Feeds the "Recent activity" dashboard widget — fire-and-forget, a failed
  // write here shouldn't interrupt viewing the document itself.
  useEffect(() => {
    if (viewingDocumentId === null) return;
    fetch("/api/recent-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "document", id: viewingDocumentId }),
    }).catch(() => {});
  }, [viewingDocumentId]);

  function openDocumentViewer(documentId: number) {
    router.replace(`/courses/${courseId}?document=${documentId}`, { scroll: false });
  }

  function closeDocumentViewer() {
    router.replace(`/courses/${courseId}`, { scroll: false });
  }

  // folderId null means "directly on the course page" — omitted from the
  // request entirely rather than sent explicitly, though either works.
  async function handleUpload(folderId: number | null, files: FileList) {
    setError(null);
    let uploaded = 0;
    for (const file of Array.from(files)) {
      if (file.name.toLowerCase().endsWith(".apkg")) {
        await importAnkiDeck(folderId, file);
        continue;
      }
      const formData = new FormData();
      formData.append("file", file);
      if (folderId !== null) formData.append("folderId", String(folderId));
      const res = await fetch(`/api/courses/${courseId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to upload ${file.name}`);
      } else {
        uploaded++;
      }
    }
    if (uploaded > 0) {
      toast.success(`Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}`);
    }
    refresh();
  }

  // An Anki package becomes flashcard sets (one per deck inside it), not a
  // document — see /api/courses/[courseId]/anki-import.
  async function importAnkiDeck(folderId: number | null, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    if (folderId !== null) formData.append("folderId", String(folderId));
    const res = await fetch(`/api/courses/${courseId}/anki-import`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? `Failed to import ${file.name}`);
      return;
    }
    const items = body.items as { title: string; cards: number }[];
    const cards = items.reduce((n, i) => n + i.cards, 0);
    toast.success(
      items.length === 1
        ? `Imported "${items[0].title}" (${cards} cards)`
        : `Imported ${items.length} decks (${cards} cards)`,
      body.mediaSkipped > 0
        ? { description: `${body.mediaSkipped} media file(s) couldn't be imported` }
        : undefined
    );
  }

  function openNewFolderDialog(parentFolderId: number | null) {
    setNewFolderParentId(parentFolderId);
    setNewFolderOpen(true);
  }

  // Pre-scopes the Upload/New note dialogs (which otherwise default to
  // whatever destination was last picked) to one specific folder — used by
  // that folder's own "+" menu, so "Upload files" from inside "App Ideas"
  // doesn't need "App Ideas" re-picked from the destination dropdown. `null`
  // pre-scopes to the course page itself (the top-level section's own "+" menu).
  function openAddToFolder(folderId: number | null, kind: "upload" | "note") {
    setUploadDestination(folderId === null ? COURSE_PAGE_SENTINEL : String(folderId));
    if (kind === "upload") setUploadOpen(true);
    else setNoteOpen(true);
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newFolderName,
          ...(newFolderParentId != null ? { parentFolderId: newFolderParentId } : {}),
        }),
      });
      const folder = await res.json();
      if (!res.ok) {
        toast.error(folder.error ?? "Couldn't create folder");
        return;
      }
      toast.success(`Created "${folder.name}"`);
      setNewFolderName("");
      setNewFolderOpen(false);
      refresh();
    } finally {
      setCreatingFolder(false);
    }
  }

  // Shared by the upload and paste-text dialogs — both pick a destination
  // folder from the same uploadDestination/uploadNewFolderName state,
  // including "+ Create new folder". `null` means "directly on the course
  // page" (see COURSE_PAGE_SENTINEL).
  async function resolveDestinationFolderId(): Promise<number | null> {
    if (uploadDestination === COURSE_PAGE_SENTINEL) {
      return null;
    }
    if (uploadDestination !== NEW_FOLDER_SENTINEL) {
      return Number(uploadDestination);
    }
    const res = await fetch(`/api/courses/${courseId}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: uploadNewFolderName }),
    });
    const folder = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(folder.error ?? "Couldn't create the new folder");
    }
    return folder.id;
  }

  // Same idea as resolveDestinationFolderId above, for the Practice card's
  // own "Save to" control — `undefined` (AUTO_DESTINATION_SENTINEL) omits
  // the field entirely so the server falls back to its own default (see
  // generateForCourse's destinationFolderId doc comment) instead of
  // resolving it to a real id here.
  async function resolveGenerationDestinationFolderId(): Promise<number | null | undefined> {
    if (generationDestination === AUTO_DESTINATION_SENTINEL) {
      return undefined;
    }
    if (generationDestination === COURSE_PAGE_SENTINEL) {
      return null;
    }
    if (generationDestination !== NEW_FOLDER_SENTINEL) {
      return Number(generationDestination);
    }
    const res = await fetch(`/api/courses/${courseId}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: generationNewFolderName }),
    });
    const folder = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(folder.error ?? "Couldn't create the new folder");
    }
    return folder.id;
  }

  async function handleUploadDialogSubmit(e: React.FormEvent) {
    e.preventDefault();
    const files = uploadFileInputRef.current?.files;
    if (!files || files.length === 0) return;
    if (uploadDestination === NEW_FOLDER_SENTINEL && !uploadNewFolderName.trim()) return;
    setUploading(true);
    try {
      const destinationId = await resolveDestinationFolderId();
      await handleUpload(destinationId, files);
      setUploadOpen(false);
      setUploadNewFolderName("");
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload");
    } finally {
      setUploading(false);
    }
  }

  async function handleTidyPasteText() {
    if (!pasteText.trim()) return;
    setTidyingPaste(true);
    try {
      const res = await fetch("/api/tidy-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't tidy this text");
        return;
      }
      setPasteText(body.text);
    } catch {
      toast.error("Couldn't tidy this text");
    } finally {
      setTidyingPaste(false);
    }
  }

  // Lets the paste-text dialog take an image (a screenshot of a slide, a
  // photo of a whiteboard, a diagram) — embedded directly into the text as
  // an inline Markdown image, the same way Obsidian embeds a pasted picture
  // into a note, rather than transcribed to text. See lib/embeddedImages.ts
  // for how this is kept out of AI prompts/search indexing everywhere else
  // the text is used, and PastedTextView.tsx for how it renders back.
  async function handlePastedImageFile(file: File) {
    setInsertingImage(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 1600, 1600, 0.85);
      const embed = `![](${dataUrl})`;
      setPasteText((prev) => (prev.trim() ? `${prev}\n\n${embed}` : embed));
    } catch {
      toast.error("Couldn't add that image");
    } finally {
      setInsertingImage(false);
    }
  }

  async function handlePasteDialogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteTitle.trim() || !pasteText.trim()) return;
    if (uploadDestination === NEW_FOLDER_SENTINEL && !uploadNewFolderName.trim()) return;
    setPasting(true);
    setError(null);
    try {
      const destinationId = await resolveDestinationFolderId();
      const res =
        pasteSaveAs === "note"
          ? await fetch(`/api/courses/${courseId}/notes`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: pasteTitle, markdown: pasteText, folderId: destinationId }),
            })
          : await fetch(`/api/courses/${courseId}/documents/paste`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: pasteTitle, text: pasteText, folderId: destinationId }),
            });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to add pasted text");
        return;
      }
      toast.success(`Added "${pasteTitle}"`);
      setPasteOpen(false);
      setPasteTitle("");
      setPasteText("");
      setPasteSaveAs("document");
      setUploadNewFolderName("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add pasted text");
    } finally {
      setPasting(false);
    }
  }

  async function handleDeleteFolder(folderId: number) {
    const res = await fetch(`/api/courses/${courseId}/folders/${folderId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't delete folder");
      return;
    }
    if (scope === String(folderId)) setScope(ALL_MATERIAL);
    toast.success("Folder deleted");
    refresh();
  }

  async function handleRenameFolder(folderId: number, name: string) {
    await fetch(`/api/courses/${courseId}/folders/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    refresh();
  }

  async function handleCustomizeFolder(
    folderId: number,
    fields: { icon?: string | null; color?: string | null }
  ) {
    await fetch(`/api/courses/${courseId}/folders/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    refresh();
  }

  async function handleDeleteDocument(documentId: number) {
    await fetch(`/api/courses/${courseId}/documents/${documentId}`, { method: "DELETE" });
    refresh();
  }

  async function handleMoveDocument(documentId: number, folderId: number | null) {
    await fetch(`/api/courses/${courseId}/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    refresh();
  }

  async function handleRenameDocument(documentId: number, filename: string) {
    const res = await fetch(`/api/courses/${courseId}/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't rename this document");
    }
    refresh();
  }

  async function handleMoveItem(itemId: number, folderId: number | null) {
    await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    refresh();
  }

  async function handleDeleteItem(itemId: number) {
    await fetch(`/api/items/${itemId}`, { method: "DELETE" });
    refresh();
  }

  async function handleMoveNote(noteId: number, folderId: number | null) {
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    refresh();
  }

  async function handleDeleteNote(noteId: number) {
    await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    refresh();
  }

  async function handleReorderNotes(folderId: number | null, orderedIds: number[]) {
    await fetch(`/api/courses/${courseId}/notes/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, orderedIds }),
    });
    refresh();
  }

  // `folderId` null omits the field entirely — the note lands directly on
  // the course page, same as an upload with no destination picked.
  async function handleCreateNote(folderId: number | null, title: string) {
    const res = await fetch(`/api/courses/${courseId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, ...(folderId != null ? { folderId } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Couldn't create note");
      return;
    }
    router.push(`/vault/${body.note.id}`);
  }

  async function handleNoteDialogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim()) return;
    if (uploadDestination === NEW_FOLDER_SENTINEL && !uploadNewFolderName.trim()) return;
    setCreatingNote(true);
    try {
      const destinationId = await resolveDestinationFolderId();
      await handleCreateNote(destinationId, noteTitle.trim());
      setNoteOpen(false);
      setNoteTitle("");
      setUploadNewFolderName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the new folder");
    } finally {
      setCreatingNote(false);
    }
  }

  async function handleBulkMove(folderId: number | null) {
    await Promise.all([
      ...Array.from(selectedDocs).map((id) =>
        fetch(`/api/courses/${courseId}/documents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId }),
        })
      ),
      ...Array.from(selectedItems).map((id) =>
        fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId }),
        })
      ),
    ]);
    const count = selectedDocs.size + selectedItems.size;
    clearSelection();
    toast.success(`Moved ${count} item${count === 1 ? "" : "s"}`);
    refresh();
  }

  async function handleBulkDelete() {
    const count = selectedDocs.size + selectedItems.size;
    await Promise.all([
      ...Array.from(selectedDocs).map((id) =>
        fetch(`/api/courses/${courseId}/documents/${id}`, { method: "DELETE" })
      ),
      ...Array.from(selectedItems).map((id) => fetch(`/api/items/${id}`, { method: "DELETE" })),
    ]);
    clearSelection();
    toast.success(`Deleted ${count} item${count === 1 ? "" : "s"}`);
    refresh();
  }

  async function handleReorderFolders(draggedFolderId: number, targetFolderId: number) {
    if (!detail) return;
    const current = detail.folders.map((f) => f.id);
    const from = current.indexOf(draggedFolderId);
    const to = current.indexOf(targetFolderId);
    if (from === -1 || to === -1) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, draggedFolderId);

    await fetch(`/api/courses/${courseId}/folders/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next }),
    });
    refresh();
  }

  // Unlike handleReorderFolders, DocumentList/GeneratedItemList already
  // compute the full new order themselves (dragging one row onto another
  // within an already-known, already-ordered array) — these just persist it.
  async function handleReorderDocuments(folderId: number | null, orderedIds: number[]) {
    await fetch(`/api/courses/${courseId}/documents/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, orderedIds }),
    });
    refresh();
  }

  async function handleReorderItems(folderId: number | null, orderedIds: number[]) {
    await fetch(`/api/courses/${courseId}/generated/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, orderedIds }),
    });
    refresh();
  }

  // Dropping a folder onto another's name/icon area nests it as a subfolder
  // — dropped elsewhere on the card, it reorders instead (see
  // handleReorderFolders and FolderCard's two drop zones).
  async function handleNestFolder(draggedFolderId: number, parentFolderId: number) {
    const res = await fetch(`/api/courses/${courseId}/folders/${draggedFolderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentFolderId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't nest that folder");
      return;
    }
    refresh();
  }

  // Dropping a subfolder into the gaps around the folder cards (rather than
  // onto another card) moves it back to the top level — the "drag it out"
  // counterpart to handleNestFolder above.
  async function handleUnnestFolder(draggedFolderId: number) {
    const res = await fetch(`/api/courses/${courseId}/folders/${draggedFolderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentFolderId: null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't move that folder");
      return;
    }
    refresh();
  }

  // "Expand all"/"Collapse all" write every folder's own collapse-state
  // localStorage key at once (see collapseKey/useCollapsed) and bump this
  // counter so every FolderCard re-reads its now-updated key — the actual
  // per-folder state stays exactly where it already lived, this just
  // seeds all of them in bulk.
  const [collapseGeneration, setCollapseGeneration] = useState(0);
  // Visual cue for the "drag a subfolder out" drop zone around the folder
  // cards — see handleUnnestFolder.
  const [folderListDragOver, setFolderListDragOver] = useState(false);
  // Same cue for the top-level "on this page" section — a document/item/note
  // dropped here gets un-filed (folder_id null).
  const [topLevelDragOver, setTopLevelDragOver] = useState(false);
  function setAllFoldersOpen(open: boolean) {
    if (!detail) return;
    for (const folder of detail.folders) {
      try {
        localStorage.setItem(collapseKey(folder.id), open ? "0" : "1");
      } catch {
        // localStorage unavailable — harmless, per-folder state just won't persist.
      }
    }
    setCollapseGeneration((g) => g + 1);
  }

  async function handleGenerate(mode: GenerationMode, quizSettings?: QuizGenerationSettings) {
    if (generationDestination === NEW_FOLDER_SENTINEL && !generationNewFolderName.trim()) return;
    setGenerating(mode);
    setError(null);
    try {
      let destinationFolderId: number | null | undefined;
      try {
        destinationFolderId = await resolveGenerationDestinationFolderId();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create the new folder");
        return;
      }
      const res = await fetch(`/api/courses/${courseId}/generate/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(generationDocIds.size > 0
            ? { documentIds: [...generationDocIds] }
            : { folderId: scope === ALL_MATERIAL ? null : Number(scope) }),
          ...(quizSettings ? { quizSettings } : {}),
          ...(destinationFolderId !== undefined ? { destinationFolderId } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Generation failed");
        return;
      }
      // Switch off "+ Create new folder" onto the folder that just got
      // created — otherwise generating again would create yet another one.
      if (generationDestination === NEW_FOLDER_SENTINEL && destinationFolderId != null) {
        setGenerationDestination(String(destinationFolderId));
        setGenerationNewFolderName("");
      }
      if (autoOpenGeneratedItems) {
        router.push(`/items/${body.id}`);
        return;
      }
      // Left in place on purpose (see Settings) — a dismissible popup
      // instead, plus the same notification also shows up on this page (the
      // banner/pill below) and on this course's card on the home page,
      // until it's opened or dismissed from any of those.
      refresh();
      const newNotification: GenerationNotification = {
        itemId: body.id,
        title: body.title,
        mode: body.mode,
        courseId: body.course_id,
        courseName: detail?.course.name ?? "",
        createdAt: body.created_at,
      };
      mutateStats(
        (prev) =>
          prev && {
            ...prev,
            generationNotifications: [newNotification, ...prev.generationNotifications],
          },
        { revalidate: false }
      );
      toast(`${MODE_LABELS[mode]} ready`, {
        description: body.title,
        duration: Infinity,
        closeButton: true,
        action: { label: "View", onClick: () => router.push(`/items/${body.id}`) },
        onDismiss: () => dismissNotification(body.id),
      });
    } finally {
      setGenerating(null);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-3">
        <h1 className="font-heading text-2xl font-semibold">Course not found</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or the link is out of date.
        </p>
        <Button variant="outline" size="sm" render={<Link href="/" />}>
          Back to your courses
        </Button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const folderChips = visibleFolderChips(
    settingsData?.folderChips ?? null,
    parseFolderChipSettings(detail.course.folder_chips)
  );

  // Hiding Practice is one click away on the card itself; bringing it back
  // lives in Customize course (and the toast's Undo, right after hiding).
  async function setShowPractice(show: boolean) {
    const res = await fetch(`/api/courses/${courseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show_practice: show }),
    });
    if (!res.ok) {
      toast.error(show ? "Couldn't show Practice" : "Couldn't hide Practice");
      return;
    }
    await refresh();
    if (!show) {
      toast("Practice hidden for this course", {
        description: "Turn it back on any time in Customize course.",
        action: { label: "Undo", onClick: () => setShowPractice(true) },
      });
    }
  }

  // Exact match — a folder card only ever shows what's filed directly in
  // it; a parent's subfolders' contents render in their own nested cards,
  // not merged in here (see FolderCard). folderId null matches whatever's
  // filed directly on the course page itself, outside any folder.
  const docsByFolder = (folderId: number | null) =>
    detail.documents.filter((d) => d.folder_id === folderId);
  const itemsByFolder = (folderId: number | null) =>
    detail.items.filter((i) => i.folder_id === folderId);
  const notesByFolder = (folderId: number | null) =>
    detail.notes.filter((n) => n.folder_id === folderId);
  const topLevelDocuments = docsByFolder(null);
  const topLevelItems = itemsByFolder(null);
  const topLevelNotes = notesByFolder(null);

  // Picking a parent folder as the generation scope pools it with its own
  // subfolders — matches buildCourseContext's scoping in lib/context.ts.
  const subfolderIdsOf = (folderId: number) =>
    detail.folders.filter((f) => f.parent_folder_id === folderId).map((f) => f.id);
  const pooledFolderIds = (folderId: number) => [folderId, ...subfolderIdsOf(folderId)];

  const scopedHasExtracted =
    generationDocIds.size > 0
      ? detail.documents.some((d) => generationDocIds.has(d.id) && d.status === "extracted")
      : scope === ALL_MATERIAL
        ? detail.documents.some((d) => d.status === "extracted")
        : pooledFolderIds(Number(scope)).some((id) =>
            docsByFolder(id).some((d) => d.status === "extracted")
          );

  const viewingDocument = viewingDocumentData?.document ?? null;

  return (
    <>
      {detail.course.page_background_image && (
        // Full-bleed, Steam-library-style backdrop — breaks out of the
        // centered max-w-5xl column on purpose (the only element on this
        // page that does) so it reads as atmosphere behind the page rather
        // than a banner inside it. Takes over the hero role that the small
        // contained cover_image banner plays below when there's no backdrop,
        // rather than showing both at once.
        <div className="relative left-1/2 -mx-[50vw] right-1/2 w-screen">
          <div
            className="relative h-64 overflow-hidden bg-cover bg-center sm:h-80"
            style={{ backgroundImage: `url(${detail.course.page_background_image})` }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-black/10" />
            <div className="relative mx-auto flex h-full max-w-5xl flex-col justify-end gap-2 px-4 pb-5 sm:px-6">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink render={<Link href="/" />} className="text-white/70 hover:text-white">
                      Study Buddy
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="text-white/50" />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="text-white/90">{detail.course.name}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="flex items-center gap-2">
                {detail.course.icon_image ? (
                  <div
                    className={`size-9 shrink-0 bg-center ${
                      detail.course.show_icon_frame
                        ? "rounded-lg border border-white/20 bg-cover bg-white/10"
                        : "bg-contain"
                    }`}
                    style={{ backgroundImage: `url(${detail.course.icon_image})` }}
                  />
                ) : (
                  detail.course.icon && (
                    <span className="text-2xl drop-shadow-sm">{detail.course.icon}</span>
                  )
                )}
                <h1 className="font-heading text-2xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-3xl">
                  {detail.course.name}
                </h1>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  onClick={() => setCustomizeOpen(true)}
                  aria-label="Customize course"
                >
                  <Palette className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    <div className="space-y-8">
      {!detail.course.page_background_image && (
      <div className="space-y-1">
        {detail.course.cover_image && (
          <div
            className="relative mb-2 h-32 overflow-hidden rounded-xl bg-cover bg-center shadow-sm ring-1 ring-black/5 sm:h-40"
            style={{ backgroundImage: `url(${detail.course.cover_image})` }}
          >
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => setCustomizeOpen(true)}
            >
              <Palette className="size-3.5" />
              Customize
            </Button>
            {detail.course.icon_image ? (
              <div
                className={`absolute bottom-2 left-2 size-11 bg-center ${
                  detail.course.show_icon_frame
                    ? "rounded-lg border bg-cover bg-background shadow-sm"
                    : "bg-contain"
                }`}
                style={{ backgroundImage: `url(${detail.course.icon_image})` }}
              />
            ) : (
              detail.course.icon && (
                <span className="absolute bottom-2 left-2 flex size-11 items-center justify-center rounded-lg border bg-background text-2xl shadow-sm">
                  {detail.course.icon}
                </span>
              )
            )}
          </div>
        )}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Study Buddy</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{detail.course.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-2">
          {!detail.course.cover_image &&
            (detail.course.icon_image ? (
              <div
                className={`size-7 shrink-0 bg-center ${
                  detail.course.show_icon_frame ? "rounded-md bg-cover" : "bg-contain"
                }`}
                style={{ backgroundImage: `url(${detail.course.icon_image})` }}
              />
            ) : (
              detail.course.icon && <span className="text-2xl">{detail.course.icon}</span>
            ))}
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{detail.course.name}</h1>
          {!detail.course.cover_image && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCustomizeOpen(true)}
              aria-label="Customize course"
            >
              <Palette className="size-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
      )}

      <CustomizeCourseDialog
        course={detail.course}
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        onSaved={refresh}
      />

      {dueItems.length > 0 && (
        // Directly answers what the home page's due-cards dot on this
        // course's card was referencing — the exact set(s) and how many
        // cards in each, not just "something's due somewhere in here".
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm">
          <Layers className="size-3.5 shrink-0 text-amber" />
          <span className="font-medium text-amber">
            {dueItems.reduce((sum, item) => sum + item.dueCount, 0)} card
            {dueItems.reduce((sum, item) => sum + item.dueCount, 0) === 1 ? "" : "s"} due:
          </span>
          {dueItems.map((item, i) => (
            <span key={item.itemId} className="text-amber">
              <Link href={`/items/${item.itemId}`} className="underline hover:no-underline">
                {item.title}
              </Link>{" "}
              ({item.dueCount}){i < dueItems.length - 1 ? "," : ""}
            </span>
          ))}
        </div>
      )}

      {notifications.length > 0 && (
        // "Jump to newly generated content automatically" (Settings) is off
        // — this is where those land instead, until opened or dismissed
        // (either here or from the popup itself). Same styling family as the
        // due-cards banner above but sage, not amber, so the two read as
        // distinct kinds of notice at a glance.
        <div className="flex flex-col gap-1.5 rounded-lg border border-sage/30 bg-sage/10 px-3 py-2 text-sm">
          {notifications.map((n) => (
            <div key={n.itemId} className="flex items-center gap-1.5 text-sage">
              <Sparkles className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <Link href={`/items/${n.itemId}`} className="underline hover:no-underline">
                  {n.title}
                </Link>{" "}
                is ready.
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5 shrink-0 text-sage hover:text-sage"
                aria-label={`Dismiss ${n.title}`}
                onClick={() => dismissNotification(n.itemId)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Generation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-base font-semibold">Folders</h2>
          <div className="flex flex-wrap items-center gap-3">
            {/* View/selection controls — a quiet segmented cluster, visually
                distinct from the content-adding actions to its right so the
                row reads as two different kinds of control, not six
                identical buttons in a row. */}
            <div className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAllFoldersOpen(true)}>
                Expand all
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAllFoldersOpen(false)}>
                Collapse all
              </Button>
              <Button
                variant={editMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={toggleEditMode}
              >
                <ListChecks />
                {editMode ? "Done" : "Select"}
              </Button>
            </div>
            <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
              <DialogTrigger
                render={<Button variant="outline" size="sm" />}
                onClick={() => openNewFolderDialog(null)}
              >
                <Plus />
                New folder
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleCreateFolder}>
                  <DialogHeader>
                    <DialogTitle>
                      {newFolderParentId != null ? "New subfolder" : "New folder"}
                    </DialogTitle>
                    <DialogDescription>
                      {newFolderParentId != null
                        ? "One level deep — e.g. \"Test 1\" inside a \"Tests\" folder."
                        : "Organize one topic — e.g. a specific test or week's lectures."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-2 py-4">
                    <Label htmlFor="folder-name">Name</Label>
                    <Input
                      id="folder-name"
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="e.g. Test 1, Week 3 lectures"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={creatingFolder || !newFolderName.trim()}>
                      {creatingFolder ? "Creating…" : "Create folder"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
              <DialogTrigger render={<Button variant="outline" size="sm" />}>
                <StickyNote />
                New note
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleNoteDialogSubmit}>
                  <DialogHeader>
                    <DialogTitle>New note</DialogTitle>
                    <DialogDescription>
                      Opens in the wiki-style note editor — pick where it should live.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="note-title">Title</Label>
                      <Input
                        id="note-title"
                        autoFocus
                        value={noteTitle}
                        onChange={(e) => setNoteTitle(e.target.value)}
                        placeholder="e.g. Lecture 4 recap"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Destination folder</Label>
                      <Select value={uploadDestination} onValueChange={(v) => v && setUploadDestination(v)}>
                        <SelectTrigger>
                          <SelectValue>
                            {(v: string) =>
                              v === NEW_FOLDER_SENTINEL
                                ? "+ Create new folder"
                                : v === COURSE_PAGE_SENTINEL
                                  ? "This course page"
                                  : (detail.folders.find((f) => String(f.id) === v)?.name ?? v)
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={COURSE_PAGE_SENTINEL}>This course page</SelectItem>
                          {detail.folders.map((folder) => (
                            <SelectItem key={folder.id} value={String(folder.id)}>
                              {folder.name}
                            </SelectItem>
                          ))}
                          <SelectItem value={NEW_FOLDER_SENTINEL}>+ Create new folder</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {uploadDestination === NEW_FOLDER_SENTINEL && (
                      <div className="grid gap-2">
                        <Label htmlFor="note-new-folder-name">New folder name</Label>
                        <Input
                          id="note-new-folder-name"
                          autoFocus
                          value={uploadNewFolderName}
                          onChange={(e) => setUploadNewFolderName(e.target.value)}
                          placeholder="e.g. Test 1"
                        />
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={
                        creatingNote ||
                        !noteTitle.trim() ||
                        (uploadDestination === NEW_FOLDER_SENTINEL && !uploadNewFolderName.trim())
                      }
                    >
                      {creatingNote ? "Creating…" : "Create note"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger render={<Button size="sm" />}>
                <Upload />
                Upload files
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleUploadDialogSubmit}>
                  <DialogHeader>
                    <DialogTitle>Upload files</DialogTitle>
                    <DialogDescription>
                      Choose documents (PDF, DOCX, ODT, PPTX), images (PNG, JPG, GIF, WEBP), or Anki decks (.apkg)
                      and where they should go. Anki decks become flashcard sets; their review history isn&apos;t imported.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="upload-files">Documents</Label>
                      <Input
                        id="upload-files"
                        ref={uploadFileInputRef}
                        type="file"
                        accept={`${UPLOAD_ACCEPT},.apkg`}
                        multiple
                        className="text-xs"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Destination folder</Label>
                      <Select value={uploadDestination} onValueChange={(v) => v && setUploadDestination(v)}>
                        <SelectTrigger>
                          <SelectValue>
                            {(v: string) =>
                              v === NEW_FOLDER_SENTINEL
                                ? "+ Create new folder"
                                : v === COURSE_PAGE_SENTINEL
                                  ? "This course page"
                                  : (detail.folders.find((f) => String(f.id) === v)?.name ?? v)
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={COURSE_PAGE_SENTINEL}>This course page</SelectItem>
                          {detail.folders.map((folder) => (
                            <SelectItem key={folder.id} value={String(folder.id)}>
                              {folder.name}
                            </SelectItem>
                          ))}
                          <SelectItem value={NEW_FOLDER_SENTINEL}>+ Create new folder</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {uploadDestination === NEW_FOLDER_SENTINEL && (
                      <div className="grid gap-2">
                        <Label htmlFor="upload-new-folder-name">New folder name</Label>
                        <Input
                          id="upload-new-folder-name"
                          autoFocus
                          value={uploadNewFolderName}
                          onChange={(e) => setUploadNewFolderName(e.target.value)}
                          placeholder="e.g. Test 1"
                        />
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={
                        uploading ||
                        (uploadDestination === NEW_FOLDER_SENTINEL && !uploadNewFolderName.trim())
                      }
                    >
                      {uploading ? "Uploading…" : "Upload"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
              <DialogTrigger render={<Button size="sm" variant="outline" />}>
                <ClipboardPaste />
                Paste text
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handlePasteDialogSubmit}>
                  <DialogHeader>
                    <DialogTitle>Paste text</DialogTitle>
                    <DialogDescription>
                      {pasteSaveAs === "note"
                        ? "Opens in the wiki-style note editor — good for your own writing, but won't be picked up as source material when generating notes/quizzes/flashcards."
                        : "For text-only material with no file — treated just like an uploaded document once added, so it can be used to generate notes/quizzes/flashcards."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3 py-4">
                    <div className="grid gap-2">
                      <Label>Save as</Label>
                      <ToggleGroup
                        value={[pasteSaveAs]}
                        onValueChange={(v: string[]) => v[0] && setPasteSaveAs(v[0] as "document" | "note")}
                        size="sm"
                        variant="outline"
                        className="self-start"
                      >
                        <ToggleGroupItem value="document">
                          <FileText className="size-3.5" />
                          Document
                        </ToggleGroupItem>
                        <ToggleGroupItem value="note">
                          <StickyNote className="size-3.5" />
                          Note
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="paste-title">Title</Label>
                      <Input
                        id="paste-title"
                        value={pasteTitle}
                        onChange={(e) => setPasteTitle(e.target.value)}
                        placeholder="e.g. Assignment 3 instructions"
                      />
                    </div>
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="paste-text">Text</Label>
                        {aiEnabled && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={handleTidyPasteText}
                            disabled={tidyingPaste || !pasteText.trim()}
                          >
                            <Wand2 className="size-3" />
                            {tidyingPaste ? "Tidying…" : "Make pretty"}
                          </Button>
                        )}
                      </div>
                      <Textarea
                        id="paste-text"
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        onPaste={(e) => {
                          const file = Array.from(e.clipboardData.items)
                            .find((item) => item.kind === "file" && item.type.startsWith("image/"))
                            ?.getAsFile();
                          if (file) {
                            e.preventDefault();
                            handlePastedImageFile(file);
                          }
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes("Files")) {
                            e.preventDefault();
                            setPasteDropActive(true);
                          }
                        }}
                        onDragLeave={() => setPasteDropActive(false)}
                        onDrop={(e) => {
                          const file = Array.from(e.dataTransfer.files).find((f) =>
                            f.type.startsWith("image/")
                          );
                          setPasteDropActive(false);
                          if (file) {
                            e.preventDefault();
                            handlePastedImageFile(file);
                          }
                        }}
                        rows={8}
                        placeholder="Paste the text here… (or paste/drop an image to embed it)"
                        // max-h + overflow-y-auto cap the textarea's own
                        // growth — it otherwise auto-sizes to its full
                        // content (see ui/textarea.tsx's field-sizing:
                        // content) with no limit, which for a long paste (or
                        // an embedded image's data URL) pushed the whole
                        // dialog taller than the viewport instead of
                        // scrolling internally.
                        className={`max-h-64 overflow-y-auto ${pasteDropActive ? "ring-2 ring-primary" : ""}`}
                        disabled={insertingImage}
                      />
                      {insertingImage && (
                        <p className="text-xs text-muted-foreground">Adding image…</p>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Label>Destination folder</Label>
                      <Select value={uploadDestination} onValueChange={(v) => v && setUploadDestination(v)}>
                        <SelectTrigger>
                          <SelectValue>
                            {(v: string) =>
                              v === NEW_FOLDER_SENTINEL
                                ? "+ Create new folder"
                                : v === COURSE_PAGE_SENTINEL
                                  ? "This course page"
                                  : (detail.folders.find((f) => String(f.id) === v)?.name ?? v)
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={COURSE_PAGE_SENTINEL}>This course page</SelectItem>
                          {detail.folders.map((folder) => (
                            <SelectItem key={folder.id} value={String(folder.id)}>
                              {folder.name}
                            </SelectItem>
                          ))}
                          <SelectItem value={NEW_FOLDER_SENTINEL}>+ Create new folder</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {uploadDestination === NEW_FOLDER_SENTINEL && (
                      <div className="grid gap-2">
                        <Label htmlFor="paste-new-folder-name">New folder name</Label>
                        <Input
                          id="paste-new-folder-name"
                          autoFocus
                          value={uploadNewFolderName}
                          onChange={(e) => setUploadNewFolderName(e.target.value)}
                          placeholder="e.g. Test 1"
                        />
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={
                        pasting ||
                        insertingImage ||
                        !pasteTitle.trim() ||
                        !pasteText.trim() ||
                        (uploadDestination === NEW_FOLDER_SENTINEL && !uploadNewFolderName.trim())
                      }
                    >
                      {pasting ? "Adding…" : "Add"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {editMode ? (
            "Check documents or generated items to move or delete several at once."
          ) : (
            <>
              Drag &amp; drop to organize
              <HelpTooltip>
                Drag documents or generated items onto a folder to move them, drag one folder onto
                another&apos;s name/icon to nest it as a subfolder (elsewhere on the card to
                reorder), drag a subfolder into the gaps around the cards to move it back to the
                top level, or drop documents straight onto a folder to upload.
              </HelpTooltip>
            </>
          )}
        </p>

        {editMode && selectedDocs.size + selectedItems.size > 0 && (
          <BulkActionBar
            count={selectedDocs.size + selectedItems.size}
            folders={detail.folders}
            onMove={handleBulkMove}
            onDelete={handleBulkDelete}
            onClear={clearSelection}
          />
        )}

        {/* Anything with no folder chosen lands here, directly on the course
            page — no card border/name row (unlike FolderCard), since this is
            the page's own content rather than a nested container. */}
        <div
          className={`space-y-2 rounded-md transition-colors ${
            topLevelDragOver ? "bg-primary/5 ring-1 ring-primary" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setTopLevelDragOver(true);
          }}
          onDragLeave={() => setTopLevelDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setTopLevelDragOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              await handleUpload(null, e.dataTransfer.files);
              return;
            }
            const payload = readDragPayload(e);
            if (!payload) return;
            if (payload.kind === "document") handleMoveDocument(payload.id, null);
            else if (payload.kind === "item") handleMoveItem(payload.id, null);
            else if (payload.kind === "note") handleMoveNote(payload.id, null);
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">On this page</span>
            <RowActionsMenu
              ariaLabel="Add to this course page"
              triggerIcon={Plus}
              actions={[
                { label: "Upload files", icon: Upload, onSelect: () => openAddToFolder(null, "upload") },
                { label: "Import Anki deck", icon: Layers, onSelect: () => openAddToFolder(null, "upload") },
                { label: "New note", icon: StickyNote, onSelect: () => openAddToFolder(null, "note") },
              ]}
            />
          </div>
          {topLevelDocuments.length + topLevelItems.length + topLevelNotes.length === 0 ? (
            detail.folders.length > 0 && (
              <p className="py-0.5 text-sm text-muted-foreground/70">
                Nothing filed directly on the course page yet.
              </p>
            )
          ) : (
            <ul className="divide-y divide-border/60">
              {topLevelDocuments.length > 0 && (
                <DocumentList
                  documents={topLevelDocuments}
                  folderId={null}
                  editMode={editMode}
                  selected={selectedDocs}
                  onToggleSelect={toggleSelectDoc}
                  onDelete={handleDeleteDocument}
                  onRename={handleRenameDocument}
                  onView={(doc) => openDocumentViewer(doc.id)}
                  onReorder={handleReorderDocuments}
                />
              )}
              {topLevelItems.length > 0 && (
                <GeneratedItemList
                  items={topLevelItems}
                  folderId={null}
                  dueByItemId={dueByItemId}
                  notifiedItemIds={notifiedItemIds}
                  editMode={editMode}
                  selected={selectedItems}
                  onToggleSelect={toggleSelectItem}
                  onDelete={handleDeleteItem}
                  onReorder={handleReorderItems}
                />
              )}
              {topLevelNotes.length > 0 && (
                <NoteList
                  notes={topLevelNotes}
                  folderId={null}
                  folders={detail.folders}
                  onMove={handleMoveNote}
                  onDelete={handleDeleteNote}
                  onReorder={handleReorderNotes}
                />
              )}
            </ul>
          )}
        </div>

        <div
          className={`space-y-3 rounded-lg transition-colors ${
            folderListDragOver ? "outline-2 outline-dashed outline-primary/40" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setFolderListDragOver(true);
          }}
          onDragLeave={() => setFolderListDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setFolderListDragOver(false);
            const payload = readDragPayload(e);
            if (payload?.kind === "folder") handleUnnestFolder(payload.id);
          }}
        >
          {detail.folders.length === 0 &&
            topLevelDocuments.length === 0 &&
            topLevelItems.length === 0 &&
            topLevelNotes.length === 0 && (
              <p className="py-1 text-sm text-muted-foreground/70">
                Nothing here yet — upload a document, paste some text, or create a folder to get started.
              </p>
            )}
          {detail.folders
            .filter((folder) => folder.parent_folder_id == null)
            .map((folder) => (
              <FolderCard
                key={`${folder.id}-${collapseGeneration}`}
                folder={folder}
                folders={detail.folders}
                docsByFolder={docsByFolder}
                itemsByFolder={itemsByFolder}
                notesByFolder={notesByFolder}
                dueByItemId={dueByItemId}
                notifiedItemIds={notifiedItemIds}
                editMode={editMode}
                selectedDocs={selectedDocs}
                selectedItems={selectedItems}
                onToggleSelectDoc={toggleSelectDoc}
                onToggleSelectItem={toggleSelectItem}
                onUpload={handleUpload}
                onDeleteDocument={handleDeleteDocument}
                onMoveDocument={handleMoveDocument}
                onRenameDocument={handleRenameDocument}
                onViewDocument={(doc) => openDocumentViewer(doc.id)}
                onMoveItem={handleMoveItem}
                onDeleteItem={handleDeleteItem}
                onMoveNote={handleMoveNote}
                onDeleteNote={handleDeleteNote}
                onReorderNotes={handleReorderNotes}
                onAddToFolder={openAddToFolder}
                onDeleteFolder={handleDeleteFolder}
                onRenameFolder={handleRenameFolder}
                onCustomizeFolder={handleCustomizeFolder}
                onReorder={handleReorderFolders}
                onReorderDocuments={handleReorderDocuments}
                onReorderItems={handleReorderItems}
                onNest={handleNestFolder}
                onCreateSubfolder={openNewFolderDialog}
                chips={folderChips}
              />
            ))}
        </div>
      </section>

      <CourseCanvasSection courseId={Number(courseId)} canvases={detail.canvases ?? []} onChanged={() => refresh()} />

      {/* The page's one primary call-to-action still gets a touch of its own
          identity — a tinted top edge and a soft background wash in the
          same accent as the Sparkles icon — but collapsed behind that same
          icon by default rather than a full card competing for attention
          alongside the folders above it. Hidden entirely with AI features
          off (see Settings' "Enable AI features") — this card is nothing
          but generation controls, so there's nothing left to show. */}
      {aiEnabled && detail.course.show_practice && (
      <Card className="gap-0 overflow-hidden border-t-2 border-t-focus bg-gradient-to-b from-focus/[0.04] to-transparent py-0">
        <Collapsible open={practiceOpen} onOpenChange={setPracticeOpen}>
          <div className="flex items-center hover:bg-focus/5">
            <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 py-3 pl-4 text-left font-heading text-base font-semibold">
              <Sparkles className="size-4 text-focus" />
              Practice
              <ChevronRight
                className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${practiceOpen ? "rotate-90" : ""}`}
              />
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon-sm"
              className="mr-2 ml-1"
              aria-label="Hide Practice for this course"
              title="Hide Practice for this course"
              onClick={() => setShowPractice(false)}
            >
              <EyeOff className="size-3.5 text-muted-foreground" />
            </Button>
          </div>
          <CollapsibleContent>
        <CardContent className="space-y-3 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm text-muted-foreground">From</Label>
            {generationDocIds.size > 0 ? (
              // A hand-picked document selection replaces the folder Select
              // entirely rather than sitting alongside it — the two answer
              // the same "From" question, so showing both would suggest
              // they combine, which they don't (see generationDocIds' own
              // comment above).
              <>
                <Badge variant="secondary" className="gap-1">
                  {generationDocIds.size} document{generationDocIds.size === 1 ? "" : "s"} selected
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setDocPickerOpen(true)}
                >
                  Change
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label="Clear document selection"
                  onClick={() => setGenerationDocIds(new Set())}
                >
                  <X className="size-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Select value={scope} onValueChange={(v) => setScope(v ?? ALL_MATERIAL)}>
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {(v: string) => {
                        if (v === ALL_MATERIAL) return "All course material";
                        const folder = detail.folders.find((f) => String(f.id) === v);
                        if (!folder) return v;
                        const hasSubfolders = subfolderIdsOf(folder.id).length > 0;
                        return hasSubfolders ? `${folder.name} (incl. subfolders)` : folder.name;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_MATERIAL}>All course material</SelectItem>
                    {detail.folders
                      .filter((folder) => folder.parent_folder_id == null)
                      .map((folder) => {
                        const subfolders = detail.folders.filter(
                          (f) => f.parent_folder_id === folder.id
                        );
                        return (
                          <SelectGroup key={folder.id}>
                            <SelectItem value={String(folder.id)}>
                              {folder.name}
                              {subfolders.length > 0 ? " (incl. subfolders)" : ""}
                            </SelectItem>
                            {subfolders.map((sub) => (
                              <SelectItem key={sub.id} value={String(sub.id)} className="pl-6">
                                {sub.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        );
                      })}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-muted-foreground"
                  onClick={() => setDocPickerOpen(true)}
                >
                  or choose documents
                </Button>
              </>
            )}
          </div>
          <DocumentPickerDialog
            open={docPickerOpen}
            onOpenChange={setDocPickerOpen}
            documents={detail.documents}
            folders={detail.folders}
            selected={generationDocIds}
            onApply={setGenerationDocIds}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm text-muted-foreground">Save to</Label>
            <Select value={generationDestination} onValueChange={(v) => v && setGenerationDestination(v)}>
              <SelectTrigger size="sm">
                <SelectValue>
                  {(v: string) =>
                    v === AUTO_DESTINATION_SENTINEL
                      ? "Same as source"
                      : v === NEW_FOLDER_SENTINEL
                        ? "+ Create new folder"
                        : v === COURSE_PAGE_SENTINEL
                          ? "This course page"
                          : (detail.folders.find((f) => String(f.id) === v)?.name ?? v)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_DESTINATION_SENTINEL}>Same as source</SelectItem>
                <SelectItem value={COURSE_PAGE_SENTINEL}>This course page</SelectItem>
                {detail.folders.map((folder) => (
                  <SelectItem key={folder.id} value={String(folder.id)}>
                    {folder.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_FOLDER_SENTINEL}>+ Create new folder</SelectItem>
              </SelectContent>
            </Select>
            {generationDestination === NEW_FOLDER_SENTINEL && (
              <Input
                autoFocus
                value={generationNewFolderName}
                onChange={(e) => setGenerationNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="h-8 w-40 text-xs"
              />
            )}
          </div>
          {!scopedHasExtracted && (
            <p className="text-sm text-muted-foreground">
              Upload at least one document that extracts successfully in this scope before generating.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MODE_LABELS) as GenerationMode[]).map((mode) => {
              const Icon = MODE_META[mode].icon;
              return (
                <Button
                  key={mode}
                  variant="outline"
                  className={`bg-card ${MODE_META[mode].borderClass}`}
                  onClick={() => (mode === "quiz" ? setQuizDialogOpen(true) : handleGenerate(mode))}
                  disabled={
                    !scopedHasExtracted ||
                    generating !== null ||
                    (generationDestination === NEW_FOLDER_SENTINEL && !generationNewFolderName.trim())
                  }
                >
                  <Icon className={MODE_META[mode].textClass} />
                  {generating === mode ? "Generating…" : MODE_LABELS[mode]}
                </Button>
              );
            })}
          </div>
        </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
      )}

      {aiEnabled && (
      <QuizGenerationDialog
        open={quizDialogOpen}
        onOpenChange={setQuizDialogOpen}
        onGenerate={(settings) => handleGenerate("quiz", settings)}
      />
      )}

      <DocumentViewer
        document={viewingDocument}
        onOpenChange={(open) => {
          if (!open) closeDocumentViewer();
        }}
        onTidied={refresh}
      />
    </div>
    </>
  );
}
