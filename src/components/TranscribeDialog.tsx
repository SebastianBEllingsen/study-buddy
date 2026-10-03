"use client";

import { useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { LoaderCircle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extensionOf, isImageExtension } from "@/lib/documentFormats";
import { MAX_PAGES, MAX_PAGES_PER_CALL, type TranscribedPage } from "@/lib/transcribe/types";
import { transcribeDocument, TooManyPagesError } from "@/lib/transcribe/client";
import { openImagePage, openPdfPages, type PageSource } from "@/lib/transcribe/render";

// "Transcribe with AI": the document's pages are drawn in the browser, sent a
// few at a time to the AI, and the Markdown it writes (equations as LaTeX,
// scans and handwriting read) becomes the document's text. Nothing is saved
// until every page is done, so stopping leaves the document as it was.

export interface TranscribableDocument {
  id: number;
  course_id: number;
  filename: string;
  page_count: number | null;
  transcribed_at: string | null;
}

// Word files can't be drawn this way; everything else the app takes can.
export function canTranscribe(filename: string): boolean {
  const ext = extensionOf(filename);
  return ["pdf", "pptx", "odt"].includes(ext) || isImageExtension(ext);
}

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Something went wrong");
  return json;
}

type Phase = { name: "intro" } | { name: "running"; done: number; total: number } | { name: "done"; pages: number; empty: number[] };

export function TranscribeDialog({
  doc,
  open,
  onOpenChange,
}: {
  doc: TranscribableDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutate } = useSWRConfig();
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const [restoring, setRestoring] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const isImage = isImageExtension(extensionOf(doc.filename));
  const isPdf = extensionOf(doc.filename) === "pdf";
  const base = `/api/courses/${doc.course_id}/documents/${doc.id}`;
  const pages = isImage ? 1 : doc.page_count;
  const calls = pages ? Math.ceil(pages / MAX_PAGES_PER_CALL) : null;
  const running = phase.name === "running";

  // The course page's document list, and anything else showing documents.
  const refresh = () => mutate((key) => typeof key === "string" && key.startsWith("/api/courses/"));

  function close(next: boolean) {
    if (!next) {
      abort.current?.abort();
      setPhase({ name: "intro" });
    }
    onOpenChange(next);
  }

  async function start() {
    const controller = new AbortController();
    abort.current = controller;
    let source: PageSource | null = null;
    setPhase({ name: "running", done: 0, total: pages ?? 0 });
    try {
      source = isImage ? await openImagePage(base) : await openPdfPages(base);
      const run = await transcribeDocument({
        source,
        signal: controller.signal,
        onProgress: (done, total) => setPhase({ name: "running", done, total }),
        send: async (batch) => ((await post(`${base}/transcribe`, { action: "batch", pages: batch })).pages ?? []) as TranscribedPage[],
      });
      await post(`${base}/transcribe`, { action: "commit", pages: run.pages });
      await refresh();
      setPhase({ name: "done", pages: run.pages.length, empty: run.empty });
    } catch (err) {
      setPhase({ name: "intro" });
      if (err instanceof DOMException && err.name === "AbortError") {
        toast("Stopped — the document is unchanged.");
      } else if (err instanceof TooManyPagesError) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't transcribe this document");
      }
    } finally {
      abort.current = null;
      void source?.destroy();
    }
  }

  async function restore() {
    setRestoring(true);
    try {
      await post(`${base}/transcribe`, { action: "restore" });
      await refresh();
      toast.success("Back to the file's own text.");
      close(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't restore the text");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transcribe with AI</DialogTitle>
          <DialogDescription>
            Reads each page as an image and writes it out with equations as LaTeX. It also reads scans and handwriting.
            The text it makes replaces this document&apos;s text.
          </DialogDescription>
        </DialogHeader>

        {phase.name === "done" ? (
          <div className="space-y-1 text-sm">
            <p>
              Transcribed {phase.pages} page{phase.pages === 1 ? "" : "s"}.
            </p>
            {phase.empty.length > 0 && (
              <p className="text-muted-foreground">
                {phase.empty.length === 1 ? "Page" : "Pages"} {phase.empty.join(", ")} came back empty — blank, or
                unreadable.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{doc.filename}</p>
            <p className="text-muted-foreground">
              {pages ? `${pages} page${pages === 1 ? "" : "s"}, about ${calls} AI call${calls === 1 ? "" : "s"}.` : "Page count known once it starts."}{" "}
              Page images are sent to your AI provider (Settings → AI).
            </p>
            {pages !== null && pages > MAX_PAGES && (
              <p className="text-clay">Up to {MAX_PAGES} pages can be transcribed at once.</p>
            )}
            {doc.transcribed_at && <p className="text-muted-foreground">Already transcribed. Running again replaces that.</p>}
            {running && (
              <div className="space-y-1 pt-1">
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={phase.total}
                  aria-valuenow={phase.done}
                  aria-label="Transcription progress"
                >
                  <div
                    className="h-full rounded-full bg-focus transition-[width]"
                    style={{ width: phase.total ? `${Math.round((phase.done / phase.total) * 100)}%` : "0%" }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {phase.total ? `${phase.done} of ${phase.total} pages` : "Opening the document…"}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase.name === "done" ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              {doc.transcribed_at && isPdf && !running && (
                <Button variant="ghost" className="sm:mr-auto" disabled={restoring} onClick={() => void restore()}>
                  {restoring ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Undo2 className="size-4" />}
                  Use the file&apos;s own text
                </Button>
              )}
              <Button variant="outline" onClick={() => close(false)}>
                {running ? "Stop" : "Cancel"}
              </Button>
              <Button disabled={running || (pages !== null && pages > MAX_PAGES)} onClick={() => void start()}>
                {running && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
                {pages ? `Transcribe ${pages} page${pages === 1 ? "" : "s"}` : "Transcribe"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
