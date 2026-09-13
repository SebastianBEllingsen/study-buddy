"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { GeneratedItem, QuizAttempt } from "@/lib/models";
import type { QuizContent, FlashcardsContent, NotesContent } from "@/lib/types";
import QuizRunner from "@/components/QuizRunner";
import FlashcardViewer from "@/components/FlashcardViewer";
import EditFlashcardsDialog from "@/components/EditFlashcardsDialog";
import NoteEditor, { type NoteEditorHandle } from "@/components/NoteEditor";
import { AskAiPanel } from "@/components/ask-ai/AskAiPanel";
import { AskAiAnswer } from "@/components/ask-ai/AskAiAnswer";
import { useCropToAsk } from "@/components/ask-ai/useCropToAsk";
import {
  CropToAskButton,
  CropSelectionOverlay,
  CropPreviewCard,
} from "@/components/ask-ai/CropToAskUI";
import { captureElementRegion } from "@/lib/cropCapture";
import ModelBadge from "@/components/ModelBadge";
import { useShowModelBadge } from "@/lib/useShowModelBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface ItemDetail {
  item: GeneratedItem;
  attempts: QuizAttempt[];
  reviews: unknown[];
  availableNewDocuments: { id: number; filename: string }[];
  dueCardIndices: number[];
}

const MODE_UNIT: Record<GeneratedItem["mode"], string> = {
  quiz: "questions",
  flashcards: "cards",
  notes: "a section",
};

// How long to wait after the last keystroke before autosaving notes content —
// same debounce as the Vault's NoteEditor (see vault/[noteId]/page.tsx) so
// both note-editing surfaces feel identical.
const AUTOSAVE_DELAY_MS = 800;

export default function ItemPage() {
  const params = useParams<{ itemId: string }>();
  const searchParams = useSearchParams();
  // A search-result snippet to scroll to and flash — see
  // SearchDialog.tsx and lib/scrollToHighlight.ts. Only notes/quiz content
  // is addressable this way; flashcards' one-card-at-a-time study queue
  // isn't, so it's ignored there (see QuizRunner/FlashcardViewer usage
  // below).
  const highlight = searchParams.get("highlight");
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [supplementing, setSupplementing] = useState(false);
  const [noteMarkdown, setNoteMarkdown] = useState("");
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [editingCards, setEditingCards] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  const noteEditorRef = useRef<NoteEditorHandle>(null);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showModelBadge = useShowModelBadge();

  // Screenshot-crop-to-ask for notes — useful for a rendered equation or
  // diagram a plain text selection (AskAiPanel below) can't capture. Reads
  // pixels via html2canvas (see lib/cropCapture.ts) rather than a <canvas>,
  // since notes are ordinary rendered Markdown/KaTeX DOM, not PDF.js output.
  const {
    cropMode: notesCropMode,
    cropRect: notesCropRect,
    toggleCropMode: toggleNotesCropMode,
    handleMouseDown: handleNotesCropMouseDown,
    handleMouseMove: handleNotesCropMouseMove,
    handleMouseUp: handleNotesCropMouseUp,
    pending: notesCropPending,
    question: notesCropQuestion,
    setQuestion: setNotesCropQuestion,
    confirmAsk: confirmNotesCropAsk,
    cancelPending: cancelNotesCropPending,
    loading: notesCropLoading,
    answer: notesCropAnswer,
    error: notesCropError,
    dismiss: dismissNotesCrop,
  } = useCropToAsk(`/api/items/${params.itemId}/ask`, (rect) =>
    notesRef.current ? captureElementRegion(notesRef.current, rect) : Promise.resolve(null)
  );

  function loadItem() {
    return fetch(`/api/items/${params.itemId}`)
      .then((r) => r.json())
      .then((body: ItemDetail) => {
        setDetail(body);
        if (body.item.mode === "notes") {
          setNoteMarkdown((JSON.parse(body.item.content_json) as NotesContent).markdown);
        }
        return body;
      });
  }

  useEffect(() => {
    loadItem().then((body) => {
      fetch(`/api/courses/${body.item.course_id}`)
        .then((r) => r.json())
        .then((courseBody) => setCourseName(courseBody.course?.name ?? null));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.itemId]);

  useEffect(() => {
    if (highlight && detail?.item.mode === "notes") {
      noteEditorRef.current?.scrollToHighlight(highlight);
    }
    // Runs once when this item's notes content first renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.item.id]);

  async function saveContent(newContent: unknown, removedCardIndices?: number[]): Promise<boolean> {
    const res = await fetch(`/api/items/${params.itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent, removedCardIndices }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't save changes");
      return false;
    }
    await loadItem();
    toast.success("Saved");
    return true;
  }

  // Quiet debounced autosave for notes content — unlike saveContent() above
  // (used for flashcards edits), this skips the toast and full item reload
  // on every keystroke, matching the Vault NoteEditor's own autosave feel.
  function handleNotesChange(value: string) {
    setNoteMarkdown(value);
    setNoteSaveState("saving");
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/items/${params.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { markdown: value } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't save note");
        setNoteSaveState("idle");
        return;
      }
      setNoteSaveState("saved");
    }, AUTOSAVE_DELAY_MS);
  }

  async function handleSupplement() {
    setSupplementing(true);
    try {
      const res = await fetch(`/api/items/${params.itemId}/supplement`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't add the new documents");
        return;
      }
      await loadItem();
      toast.success("Added new material from the uploaded documents");
    } catch {
      toast.error("Couldn't add the new documents");
    } finally {
      setSupplementing(false);
    }
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const { item, attempts } = detail;
  const content = JSON.parse(item.content_json);
  // attempts is already ORDER BY started_at DESC, so [0] is the most recent.
  const completedAttempts = attempts.filter(
    (a): a is QuizAttempt & { completed_at: string; score: number } =>
      a.completed_at != null && a.score != null
  );
  const bestScore =
    completedAttempts.length > 0
      ? Math.max(...completedAttempts.map((a) => a.score))
      : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Study Buddy</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/courses/${item.course_id}`} />}>
                {courseName ?? "Course"}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{item.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="flex flex-wrap items-center gap-2 font-heading text-2xl font-semibold">
          {item.title}
          {showModelBadge && <ModelBadge info={item} />}
        </h1>
      </div>

      {detail.availableNewDocuments.length > 0 && (
        <Alert>
          <Sparkles />
          <AlertTitle>
            {detail.availableNewDocuments.length} new document
            {detail.availableNewDocuments.length === 1 ? "" : "s"} uploaded since this
            was generated
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Add {MODE_UNIT[item.mode]} from the new material without redoing the rest.</span>
            <Button size="sm" onClick={handleSupplement} disabled={supplementing}>
              {supplementing ? "Adding…" : "Add to this set"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {item.mode === "notes" && (
        <>
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">
              {noteSaveState === "saving" ? "Saving…" : noteSaveState === "saved" ? "Saved" : ""}
            </span>
            <CropToAskButton active={notesCropMode} onClick={toggleNotesCropMode} />
          </div>
          <Card
            ref={notesRef}
            className={`h-[70vh] overflow-hidden ${notesCropMode ? "cursor-crosshair select-none" : ""}`}
            onMouseDown={handleNotesCropMouseDown}
            onMouseMove={handleNotesCropMouseMove}
            onMouseUp={handleNotesCropMouseUp}
          >
            <CardContent className="h-full p-0">
              <NoteEditor ref={noteEditorRef} value={noteMarkdown} onChange={handleNotesChange} />
            </CardContent>
          </Card>
          <CropSelectionOverlay rect={notesCropRect} />
          {notesCropPending && (
            <CropPreviewCard
              dataUrl={notesCropPending}
              question={notesCropQuestion}
              onQuestionChange={setNotesCropQuestion}
              onConfirm={confirmNotesCropAsk}
              onCancel={cancelNotesCropPending}
              loading={notesCropLoading}
            />
          )}
          {(notesCropLoading || notesCropAnswer || notesCropError) && (
            <AskAiAnswer
              loading={notesCropLoading}
              answer={notesCropAnswer}
              error={notesCropError}
              onDismiss={dismissNotesCrop}
            />
          )}
          <AskAiPanel endpoint={`/api/items/${item.id}/ask`} containerRef={notesRef} />
        </>
      )}

      {item.mode === "quiz" && (
        <>
          {completedAttempts.length > 0 && (
            <p className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>Best {bestScore!.toFixed(0)}%</span>
              <span>Last {completedAttempts[0].score!.toFixed(0)}%</span>
            </p>
          )}
          <QuizRunner
            itemId={item.id}
            questions={(content as QuizContent).questions}
            onSubmitted={() => loadItem()}
            highlightQuery={highlight ?? undefined}
          />
          {attempts.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                Previous attempts
              </h2>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {attempts.map((a) => (
                  <li key={a.id}>
                    {a.completed_at
                      ? `${a.score?.toFixed(0)}% — ${new Date(a.completed_at).toLocaleString()}`
                      : "In progress"}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {item.mode === "flashcards" && (
        <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setEditingCards(true)}>
              <Pencil className="size-3.5" />
              Edit cards
            </Button>
          </div>
          <FlashcardViewer
            itemId={item.id}
            cards={(content as FlashcardsContent).cards}
            dueCardIndices={detail.dueCardIndices}
          />
          <EditFlashcardsDialog
            open={editingCards}
            onOpenChange={setEditingCards}
            cards={(content as FlashcardsContent).cards}
            onSave={(cards, removedIndices) => saveContent({ cards }, removedIndices)}
          />
        </>
      )}
    </div>
  );
}
