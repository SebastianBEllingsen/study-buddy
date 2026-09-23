"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// One centralized "how does this app work" overview — the point being that
// individual dialogs/menus elsewhere (Settings, the note editor toolbar,
// widget customization, ...) can stay lean and self-evident instead of each
// growing its own explanatory copy/mini-tutorial. Kept intentionally short:
// this is a map of where things live, not a manual — same "concise
// overview" scope as the README's own "How to use it" section, which this
// mirrors, not replaces.
function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export default function HelpDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon-sm" aria-label="Help" onClick={() => setOpen(true)}>
        <HelpCircle className="size-4 text-muted-foreground" />
      </Button>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick guide</DialogTitle>
          <DialogDescription>
            The short version — everything here has more detail in place once you&apos;re using it.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <HelpSection title="Courses & material">
            Create a course, then upload PDFs (or paste text/images) into folders. Drag things
            between folders to reorganize.
          </HelpSection>
          <HelpSection title="Generate">
            From a folder — or &quot;All course material&quot; — generate Notes, a Quiz, or
            Flashcards with one click. Uploaded more PDFs later? Open the existing set and a banner
            offers to add just the new material instead of starting over.
          </HelpSection>
          <HelpSection title="Study">
            Quizzes grade instantly and offer a &quot;Retry what you got wrong&quot;. Flashcards
            only surface what&apos;s actually due, using real spaced repetition. Select any text (or
            crop a region of a PDF) for a hint or explanation.
          </HelpSection>
          <HelpSection title="Pomodoro timer">
            The timer icon in the header starts a focus session that keeps running on every page;
            the gear sets your lengths, and its buttons open a fullscreen focus view or pop the timer
            out into its own window.
          </HelpSection>
          <HelpSection title="The Vault">
            Your own Obsidian-style notes, separate from generated material. Type{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">[[</code> to link another note,
            document, or generated item. Toggle Edit/Preview with the buttons in the note&apos;s own
            toolbar, or{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              ⌘E
            </kbd>
            .
          </HelpSection>
          <HelpSection title="Calendar">
            Connect your own Google Calendar (Settings) or subscribe to a read-only ICS feed (your
            school&apos;s deadline calendar, for example) to see and manage deliverables from the
            Calendar page and the dashboard widgets.
          </HelpSection>
          <HelpSection title="Your dashboard">
            Click Customize on either widget grid (above or below your course list) to add, move,
            resize, or hide widgets — streak, due cards, upcoming events, assignments, recent
            activity, and more.
          </HelpSection>
          <HelpSection title="AI backend">
            Pick one from Settings — an API key (Anthropic, OpenAI, Gemini), a Claude Code/Codex
            CLI subscription, or a free tier via OpenRouter. Nothing generates until you do.
          </HelpSection>
          <HelpSection title="Shortcuts">
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              ⌘K
            </kbd>{" "}
            or{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              /
            </kbd>{" "}
            — search anything, anywhere.{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              ⌘E
            </kbd>{" "}
            — toggle Edit/Preview in a note.
          </HelpSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
