"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { toast } from "sonner";
import { ArrowUp, Bot, Plus, Trash2 } from "lucide-react";
import type { ChatConversation, ChatMessage } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Loads the conversation list once, on mount — render-phase sync (see
  // DocumentPickerDialog's own seeded flag elsewhere in this app) rather
  // than a useEffect, since loadConversations' own setState calls would
  // otherwise trigger the cascading-render lint rule.
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    setLoaded(true);
    loadConversations();
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function loadConversations() {
    const list: ChatConversation[] = await fetch("/api/chat/conversations").then((r) => r.json());
    setConversations(list);
    if (initialConversationId && list.some((c) => c.id === initialConversationId)) {
      selectConversation(initialConversationId);
    } else if (list.length > 0) {
      selectConversation(list[0].id);
    } else {
      startNewChat();
    }
  }

  async function selectConversation(id: number) {
    setActiveId(id);
    setLoadingConversation(true);
    const detail: { messages: ChatMessage[] } = await fetch(`/api/chat/conversations/${id}`).then((r) =>
      r.json()
    );
    setMessages(detail.messages);
    setLoadingConversation(false);
  }

  function startNewChat() {
    // No conversation is actually created until the first message is sent
    // (see handleSend) — same as ChatGPT/Claude, so clicking "New chat"
    // repeatedly doesn't litter the history with empty conversations.
    setActiveId(null);
    setMessages([]);
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

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    setSending(true);

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
        { id: -Date.now(), conversationId: conversationId!, role: "user", content, createdAt: "" },
      ]);

      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't get a reply");
        return;
      }
      setMessages((prev) => [...prev, body as ChatMessage]);
      // Refreshes title (set from the first message) and reordering.
      const list: ChatConversation[] = await fetch("/api/chat/conversations").then((r) => r.json());
      setConversations(list);
    } catch {
      toast.error("Couldn't get a reply");
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
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Bot className="size-4" />
              AI chat
            </span>
            <div className="flex items-center gap-1">{headerActions}</div>
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
                  {m.role === "assistant" ? (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
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

          <div className="flex shrink-0 items-end gap-2 border-t p-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message…"
              className="max-h-40 min-h-10 flex-1 resize-none py-2"
              rows={1}
            />
            <Button
              size="icon-sm"
              disabled={!draft.trim() || sending}
              onClick={handleSend}
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
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
    </>
  );
}
