"use client";

import { useState } from "react";
import { Bot, ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ChatContent from "@/components/ChatContent";

// A general-purpose AI assistant, independent of any course/document — see
// ChatContent for the actual conversation UI (shared with the standalone
// "detached" window at app/chat/view/page.tsx).
export default function ChatDialog() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);

  // Pops the exact same chat (ChatContent) into its own browser window, at
  // whichever conversation is currently open — e.g. so it can sit alongside
  // the app while you work elsewhere. Closes this dialog rather than
  // leaving both open — the content has moved, not duplicated, and two live
  // copies would drift out of sync with each other (each only refreshes on
  // its own send/select, not in real time).
  function handleDetach() {
    const url = activeId ? `/chat/view?conversation=${activeId}` : "/chat/view";
    window.open(url, "study-buddy-chat", "noopener,width=900,height=700");
    setOpen(false);
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
        <ChatContent
          onActiveConversationChange={setActiveId}
          headerActions={
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Detach" onClick={handleDetach}>
                <ExternalLink className="size-3.5" />
              </Button>
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
            </>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
