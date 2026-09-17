"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { toast } from "sonner";
import { ArrowUp, Bot, BookOpen, FileText, Paperclip, Plus, Save, Trash2, X } from "lucide-react";
import type { ChatAttachment, ChatConversation, ChatMessage, CourseSummary } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { resizeImageForNote } from "@/lib/resizeImage";
import { extensionOf } from "@/lib/documentFormats";
import { normalizeLatexDelimiters } from "@/lib/mathSanitizer";
import SaveAttachmentToCourseDialog, {
  type SaveableAttachment,
} from "@/components/SaveAttachmentToCourseDialog";

// Mirrors dataUrlImage.ts's MAX_CHAT_IMAGE_LENGTH — duplicated here rather
// than imported since that module pulls in server-only blob-storage config
// resolution that can't bundle for the browser (see aiBackendChoices.ts's
// own comment for the same reasoning). This is just a client-side early
// check to avoid a doomed round trip; the server enforces its own copy of
// this limit regardless.
const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 4_000_000;
// Raw byte cap for a chat document attachment before base64 encoding —
// same order of magnitude as the server's MAX_CHAT_DOCUMENT_BASE64_LENGTH
// (chat.ts), expressed in raw bytes rather than encoded length.
const MAX_CHAT_DOCUMENT_BYTES = 15_000_000;
const CHAT_DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);

type ComposerAttachment =
  | { localId: number; type: "image"; filename: string; mimeType: string; dataUrl: string }
  | { localId: number; type: "document"; filename: string; mimeType: string; fileBase64: string };

// Plain Omit collapses a discriminated union to its common keys, losing the
// per-variant discriminant precision addAttachmentDraft below needs —
// distributing over the union first (T extends any ? ... : never) keeps
// each variant's own shape intact.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function composerAttachmentToRaw(a: ComposerAttachment) {
  return a.type === "image"
    ? { type: "image" as const, filename: a.filename, mimeType: a.mimeType, dataUrl: a.dataUrl }
    : { type: "document" as const, filename: a.filename, mimeType: a.mimeType, fileBase64: a.fileBase64 };
}

// Placeholder extractedText — the real extraction happens server-side (see
// chat.ts's validateAndExtractAttachments); this is only used for the
// optimistic local echo of the user's own just-sent message, whose
// attachment rendering never reads extractedText anyway (see the message
// bubble below).
function composerAttachmentToChatAttachment(a: ComposerAttachment): ChatAttachment {
  return a.type === "image"
    ? { type: "image", filename: a.filename, mimeType: a.mimeType, dataUrl: a.dataUrl }
    : { type: "document", filename: a.filename, mimeType: a.mimeType, fileBase64: a.fileBase64, extractedText: "" };
}

// The actual conversation list + message thread + composer — everything
// independent of whatever shell it's mounted in. Shared by ChatDialog's
// in-app Dialog and the standalone "detached" window
// (app/chat/view/page.tsx), which pops this exact same chat into its own
// browser window rather than a cut-down copy — see lib/chat.ts for how a
// reply is generated and the chat_conversations/chat_messages tables in
// schema.sql for how history is persisted.
export default function ChatContent({
  headerActions,
  initialConversationId,
  onActiveConversationChange,
}: {
  // Rendered in the internal header row, next to the "AI chat" label — the
  // Dialog shell passes Detach/Full screen/Close buttons here; the
  // standalone window passes nothing (a real browser tab already has those).
  headerActions?: React.ReactNode;
  // Opens straight into a specific conversation instead of the most recent
  // one — used by the detached window so it picks up exactly the
  // conversation you were looking at, not just whichever happens to be
  // newest (usually the same, but not if you'd been browsing an older one).
  initialConversationId?: number;
  // Lets ChatDialog's own Detach button carry over whichever conversation
  // is currently open — ChatContent owns activeId, the shell doesn't.
  onActiveConversationChange?: (id: number | null) => void;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveIdState] = useState<number | null>(null);
  function setActiveId(id: number | null) {
    setActiveIdState(id);
    onActiveConversationChange?.(id);
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<ComposerAttachment[]>([]);
  const [pasteDropActive, setPasteDropActive] = useState(false);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [savingCourseScope, setSavingCourseScope] = useState(false);
  const [saveTarget, setSaveTarget] = useState<SaveableAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Monotonic, not Date.now()-based — two sends within the same
  // millisecond (trivially reachable by pressing Enter twice fast, or a
  // slow network turning "type, send, retype, send" into near-simultaneous
  // requests) previously produced the same negative id, so the rollback
  // filter on a failed send (`m.id !== optimisticId`) would remove both
  // optimistic messages instead of just the one that actually failed.
  const nextOptimisticId = useRef(0);
  const nextAttachmentId = useRef(0);
  // Guards against a slower selectConversation(A) response landing after a
  // faster selectConversation(B) and overwriting B's messages with A's
  // stale ones — reachable just by clicking two conversations in quick
  // succession. Same pattern SearchDialog uses for the same reason.
  const selectRequestId = useRef(0);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  // Loads the conversation list once, on mount — render-phase sync (see
  // DocumentPickerDialog's own seeded flag elsewhere in this app) rather
  // than a useEffect, since loadConversations' own setState calls would
  // otherwise trigger the cascading-render lint rule.
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    setLoaded(true);
    loadConversations();
    fetch("/api/courses")
      .then((r) => r.json())
      .then(setCourses)
      .catch(() => {});
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function loadConversations() {
    try {
      const list: ChatConversation[] = await fetch("/api/chat/conversations").then((r) => r.json());
      setConversations(list);
      if (initialConversationId && list.some((c) => c.id === initialConversationId)) {
        selectConversation(initialConversationId);
      } else if (list.length > 0) {
        selectConversation(list[0].id);
      } else {
        startNewChat();
      }
    } catch {
      // Left as an empty list rather than stuck in a permanent loading
      // state — the "New chat" affordance below still works even with no
      // history loaded.
      toast.error("Couldn't load chat history");
    }
  }

  async function selectConversation(id: number) {
    const requestId = ++selectRequestId.current;
    setActiveId(id);
    setLoadingConversation(true);
    try {
      const detail: { messages: ChatMessage[] } = await fetch(`/api/chat/conversations/${id}`).then((r) =>
        r.json()
      );
      if (requestId !== selectRequestId.current) return; // a newer selectConversation call has since started
      setMessages(detail.messages);
    } catch {
      if (requestId !== selectRequestId.current) return;
      toast.error("Couldn't load this conversation");
    } finally {
      if (requestId === selectRequestId.current) setLoadingConversation(false);
    }
  }

  function startNewChat() {
    // No conversation is actually created until the first message is sent
    // (see handleSend) — same as ChatGPT/Claude, so clicking "New chat"
    // repeatedly doesn't litter the history with empty conversations.
    setActiveId(null);
    setMessages([]);
    setAttachmentDrafts([]);
  }

  async function handleConfirmDeleteConversation() {
    if (deleteTargetId === null) return;
    const id = deleteTargetId;
    setDeletingConversation(true);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) startNewChat();
      setDeleteTargetId(null);
    } catch {
      toast.error("Couldn't delete that conversation");
    } finally {
      setDeletingConversation(false);
    }
  }

  async function handleResolveAction(messageId: number, confirm: boolean) {
    if (activeId === null) return;
    const optimisticStatus = confirm ? "confirmed_executing" : "cancelled";
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.pendingAction
          ? { ...m, pendingAction: { ...m.pendingAction, status: optimisticStatus } }
          : m
      )
    );
    try {
      const res = await fetch(`/api/chat/conversations/${activeId}/messages/${messageId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      if (!res.ok) throw new Error("Couldn't resolve that action");
      const updated: ChatMessage = await res.json();
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
    } catch {
      toast.error("Couldn't update that action");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.pendingAction ? { ...m, pendingAction: { ...m.pendingAction, status: "pending" } } : m
        )
      );
    }
  }

  async function handleCourseScopeChange(courseId: number | null) {
    if (activeId === null) return;
    const previous = activeConversation?.courseId ?? null;
    setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, courseId } : c)));
    setSavingCourseScope(true);
    try {
      const res = await fetch(`/api/chat/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) throw new Error("Couldn't update course");
    } catch {
      toast.error("Couldn't scope this conversation to that course");
      setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, courseId: previous } : c)));
    } finally {
      setSavingCourseScope(false);
    }
  }

  function addAttachmentDraft(draft: DistributiveOmit<ComposerAttachment, "localId">) {
    setAttachmentDrafts((prev) => [...prev, { ...draft, localId: --nextAttachmentId.current }]);
  }

  async function handleIncomingFiles(files: File[]) {
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const blob = await resizeImageForNote(file);
          const dataUrl = await blobToDataUrl(blob);
          if (dataUrl.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH) {
            toast.error(`${file.name} is too large`);
            continue;
          }
          addAttachmentDraft({ type: "image", filename: file.name, mimeType: blob.type, dataUrl });
        } catch {
          toast.error(`Couldn't attach ${file.name}`);
        }
        continue;
      }

      const ext = extensionOf(file.name);
      if (!CHAT_DOCUMENT_EXTENSIONS.has(ext)) {
        toast.error(`${file.name}: only images, PDF, and DOCX files are supported`);
        continue;
      }
      if (file.size > MAX_CHAT_DOCUMENT_BYTES) {
        toast.error(`${file.name} is too large`);
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        addAttachmentDraft({
          type: "document",
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileBase64: arrayBufferToBase64(buffer),
        });
      } catch {
        toast.error(`Couldn't attach ${file.name}`);
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) {
      e.preventDefault();
      handleIncomingFiles(files);
    }
  }

  function removeAttachmentDraft(localId: number) {
    setAttachmentDrafts((prev) => prev.filter((a) => a.localId !== localId));
  }

  async function handleSend() {
    const content = draft.trim();
    const attachments = attachmentDrafts;
    if ((!content && attachments.length === 0) || sending) return;
    setDraft("");
    setAttachmentDrafts([]);
    setSending(true);

    // A failed send below removes exactly this optimistic message (by id)
    // and restores `content`/attachments to the input — without this, a
    // network error or non-ok response left a "sent" message stuck in the
    // transcript forever with no reply and no way to recover the original
    // text (the draft was already cleared above). Negative and decrementing
    // (never 0 or positive) so it can never collide with a real,
    // server-assigned id.
    const optimisticId = --nextOptimisticId.current;
    let conversationId = activeId;
    try {
      if (conversationId === null) {
        const created: ChatConversation = await fetch("/api/chat/conversations", {
          method: "POST",
        }).then((r) => r.json());
        conversationId = created.id;
        setActiveId(created.id);
        setConversations((prev) => [created, ...prev]);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          conversationId: conversationId!,
          role: "user",
          content,
          attachments: attachments.length > 0 ? attachments.map(composerAttachmentToChatAttachment) : null,
          pendingAction: null,
          createdAt: "",
        },
      ]);

      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, attachments: attachments.map(composerAttachmentToRaw) }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't get a reply");
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setDraft(content);
        setAttachmentDrafts(attachments);
        return;
      }
      setMessages((prev) => [...prev, body as ChatMessage]);
      // Refreshes title (set from the first message) and reordering.
      const list: ChatConversation[] = await fetch("/api/chat/conversations").then((r) => r.json());
      setConversations(list);
    } catch {
      toast.error("Couldn't get a reply");
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(content);
      setAttachmentDrafts(attachments);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-48 shrink-0 flex-col gap-2 border-r bg-muted/20 p-2">
          <Button variant="outline" size="sm" className="justify-start gap-1.5" onClick={startNewChat}>
            <Plus className="size-3.5" />
            New chat
          </Button>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {conversations.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(c.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectConversation(c.id)}
                className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-xs ${
                  c.id === activeId ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{c.title ?? "New chat"}</span>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  className="shrink-0 opacity-0 hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTargetId(c.id);
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Bot className="size-4" />
              AI chat
            </span>
            <div className="flex items-center gap-1.5">
              {activeId !== null && (
                <Select
                  value={activeConversation?.courseId != null ? String(activeConversation.courseId) : "none"}
                  onValueChange={(v) => handleCourseScopeChange(v === "none" ? null : Number(v))}
                  disabled={savingCourseScope}
                >
                  <SelectTrigger
                    size="sm"
                    title="Scope this chat to a course"
                    className={`max-w-44 gap-1.5 rounded-full border-transparent px-2.5 shadow-none transition-colors ${
                      activeConversation?.courseId != null
                        ? "bg-primary/10 text-primary hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <BookOpen className="size-3.5 shrink-0" />
                    <SelectValue placeholder="No course">
                      {(v: string) =>
                        v === "none" ? "No course" : (courses.find((c) => String(c.id) === v)?.name ?? v)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No course</SelectItem>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {activeId !== null && headerActions && <div className="mx-1 h-4 w-px shrink-0 bg-border" />}
              {headerActions}
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !loadingConversation && (
              <p className="text-sm text-muted-foreground">
                Ask anything — about your courses, or otherwise.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {(m.attachments ?? []).map((a, i) =>
                    a.type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={a.dataUrl}
                        alt={a.filename}
                        className="mb-1.5 max-h-48 rounded-md object-contain"
                      />
                    ) : (
                      <div
                        key={i}
                        className="mb-1.5 flex items-center gap-1.5 rounded-md bg-black/10 px-2 py-1 text-xs"
                      >
                        <FileText className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{a.filename}</span>
                        <button
                          type="button"
                          aria-label="Save to course"
                          title="Save to course"
                          className="shrink-0 hover:opacity-70"
                          onClick={() =>
                            setSaveTarget({ filename: a.filename, mimeType: a.mimeType, fileBase64: a.fileBase64 })
                          }
                        >
                          <Save className="size-3.5" />
                        </button>
                      </div>
                    )
                  )}
                  {m.role === "assistant" ? (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {normalizeLatexDelimiters(m.content)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    m.content && <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                  {m.pendingAction && (
                    <div className="mt-2 border-t pt-2">
                      {m.pendingAction.status === "pending" && (
                        <div className="flex gap-1.5">
                          <Button size="xs" onClick={() => handleResolveAction(m.id, true)}>
                            Confirm
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => handleResolveAction(m.id, false)}>
                            Cancel
                          </Button>
                        </div>
                      )}
                      {m.pendingAction.status === "confirmed_executing" && (
                        <p className="text-xs text-muted-foreground">Working on it…</p>
                      )}
                      {m.pendingAction.status === "cancelled" && (
                        <p className="text-xs text-muted-foreground">Cancelled.</p>
                      )}
                      {(m.pendingAction.status === "executed" || m.pendingAction.status === "failed") && (
                        <p
                          className={`text-xs ${m.pendingAction.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {m.pendingAction.resultSummary}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t p-3">
            {attachmentDrafts.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachmentDrafts.map((a) => (
                  <div
                    key={a.localId}
                    className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
                  >
                    {a.type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.dataUrl} alt={a.filename} className="size-5 rounded object-cover" />
                    ) : (
                      <FileText className="size-3.5 shrink-0" />
                    )}
                    <span className="max-w-32 truncate">{a.filename}</span>
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      onClick={() => removeAttachmentDraft(a.localId)}
                      className="shrink-0 hover:opacity-70"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div
              className={`flex items-end gap-2 ${pasteDropActive ? "rounded-md ring-2 ring-primary" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setPasteDropActive(true);
              }}
              onDragLeave={() => setPasteDropActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setPasteDropActive(false);
                handleIncomingFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleIncomingFiles(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Attach a file"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onPaste={handlePaste}
                placeholder="Message…"
                className="max-h-40 min-h-10 flex-1 resize-none py-2"
                rows={1}
              />
              <Button
                size="icon-sm"
                disabled={(!draft.trim() && attachmentDrafts.length === 0) || sending}
                onClick={handleSend}
                aria-label="Send"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(next) => !next && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingConversation}
              onClick={handleConfirmDeleteConversation}
            >
              {deletingConversation ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SaveAttachmentToCourseDialog
        attachment={saveTarget}
        onOpenChange={(open) => !open && setSaveTarget(null)}
      />
    </>
  );
}
