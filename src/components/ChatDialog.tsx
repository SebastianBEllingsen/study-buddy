"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { toast } from "sonner";
import { ArrowUp, Bot, Maximize2, Minimize2, Plus, Trash2, X } from "lucide-react";
import type { ChatConversation, ChatMessage } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// A general-purpose AI assistant, independent of any course/document — see
// lib/chat.ts for how a reply is generated (the whole transcript folded
// into one generateText call, so it works identically across every AI
// backend with no per-backend changes) and the chat_conversations/
// chat_messages tables in schema.sql for how history is persisted.
export default function ChatDialog() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Loads the conversation list fresh each time the dialog opens — render-
  // phase sync (see DocumentPickerDialog's own seeded flag elsewhere in this
  // app) rather than a useEffect.
  const [loadedForOpen, setLoadedForOpen] = useState(false);
  if (open && !loadedForOpen) {
    setLoadedForOpen(true);
    loadConversations();
  } else if (!open && loadedForOpen) {
    setLoadedForOpen(false);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function loadConversations() {
    const list: ChatConversation[] = await fetch("/api/chat/conversations").then((r) => r.json());
    setConversations(list);
    if (list.length > 0) {
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

  async function handleDeleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) startNewChat();
    await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" }).catch(() => {});
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
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon-sm" aria-label="AI chat" onClick={() => setOpen(true)}>
        <Bot className="size-4 text-muted-foreground" />
      </Button>
      <DialogContent
        showCloseButton={false}
        className={
          // Only sizing changes here — top-1/2/left-1/2/-translate-1/2 (from
          // DialogContent's own base className) are left alone rather than
          // zeroed out: centering a w-screen/h-screen box via "50%, then
          // translate back by half of the element's OWN size" already lands
          // it at (0,0) filling the viewport, since half of a 100vw/100vh
          // element is exactly 50vw/50vh. Overriding those classes too was
          // fighting Base UI's own open/close transition state for no
          // reason — same visual result either way, this way doesn't fight it.
          // sm:max-w-none is still needed since DialogContent's sm:max-w-sm
          // is a distinct variant-scoped slot a plain max-w-none can't reach.
          fullscreen
            ? "flex h-screen w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none"
            : "flex h-[80vh] w-full max-w-3xl flex-col gap-0 p-0 sm:max-w-3xl"
        }
      >
        <DialogTitle className="sr-only">AI chat</DialogTitle>
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
                    onClick={(e) => handleDeleteConversation(c.id, e)}
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
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                  onClick={() => setFullscreen((v) => !v)}
                >
                  {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
                  <X className="size-3.5" />
                </Button>
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
      </DialogContent>
    </Dialog>
  );
}
