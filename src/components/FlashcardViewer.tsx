"use client";

import { useEffect, useRef, useState } from "react";
import { PartyPopper, CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import type { Flashcard } from "@/lib/types";
import type { FlashcardResult } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AskAiPanel } from "@/components/ask-ai/AskAiPanel";
import { CardFace } from "@/components/CardFace";
import { tap } from "@/lib/haptics";

// Colors span the same recall-confidence gradient used everywhere else in
// the app: Clay (forgot) → Amber (struggled) → Sage (got it) → Focus
// (mastered) — not an unrelated red/orange/green/blue set.
const RESULT_LABELS: { result: FlashcardResult; label: string; className: string }[] = [
  { result: "again", label: "Again", className: "bg-clay/10 text-clay hover:bg-clay/20" },
  { result: "hard", label: "Hard", className: "bg-amber/10 text-amber hover:bg-amber/20" },
  { result: "good", label: "Good", className: "bg-sage/10 text-sage hover:bg-sage/20" },
  { result: "easy", label: "Easy", className: "bg-focus/10 text-focus hover:bg-focus/20" },
];

export default function FlashcardViewer({
  itemId,
  cards,
  dueCardIndices,
}: {
  itemId: number;
  cards: Flashcard[];
  dueCardIndices: number[];
}) {
  // The queue of card indices for this session — due cards by default, or
  // every card if the student explicitly asks to cram ahead of schedule.
  const [queue, setQueue] = useState<number[] | null>(
    dueCardIndices.length > 0 ? dueCardIndices : null
  );
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [logged, setLogged] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const done = queue !== null && position >= queue.length;
  const cardIndex = queue?.[position];
  const card = cardIndex != null ? cards[cardIndex] : undefined;

  // Only the front, unless the back has actually been revealed — matches
  // what's currently on screen, same principle as the quiz side.
  function getWholeContext() {
    if (!card) return "";
    return flipped ? `${card.front}\n\n${card.back}` : card.front;
  }

  function handleCardClick() {
    // Don't flip if the click is the tail end of a text-selection drag.
    if (window.getSelection()?.toString().trim()) return;
    tap(10);
    setFlipped((f) => !f);
  }

  async function handleResult(result: FlashcardResult) {
    if (cardIndex == null) return;
    try {
      const res = await fetch(`/api/items/${itemId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardIndex, result }),
      });
      if (!res.ok) {
        toast.error("Couldn't save that review — try again");
        return;
      }
    } catch {
      toast.error("Couldn't save that review — try again");
      return;
    }
    setLogged((n) => n + 1);
    setFlipped(false);
    setPosition((p) => p + 1);
  }

  // 1-4 rate the revealed card (Again/Hard/Good/Easy, left to right —
  // matches RESULT_LABELS) — reviewing a deck one card at a time is the
  // single most repetitive action in the app, so reaching for the mouse
  // every card is real friction. Ignored while typing anywhere (e.g. the
  // Ask AI panel's input) so it never hijacks normal text entry.
  useEffect(() => {
    if (!flipped) return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const index = ["1", "2", "3", "4"].indexOf(e.key);
      if (index === -1) return;
      e.preventDefault();
      handleResult(RESULT_LABELS[index].result);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // handleResult closes over cardIndex/itemId, both already reflected by
    // re-running this effect whenever `flipped` flips back on for a new card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, cardIndex]);

  // No cards due — the "all caught up" state, with a way to review anyway.
  if (queue === null) {
    return (
      <Card className="items-center gap-3 py-12 text-center">
        <CalendarCheck className="size-8 animate-pop-in text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">All caught up.</p>
          <p className="text-sm text-muted-foreground">
            No cards are due for review right now.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setQueue(cards.map((_, i) => i));
            setPosition(0);
          }}
        >
          Review all {cards.length} cards anyway
        </Button>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="items-center py-12 text-center">
        <PartyPopper className="size-8 animate-pop-in text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">Reviewed all {queue.length} cards.</p>
          <p className="text-sm text-muted-foreground">
            {logged} results logged this session.
          </p>
        </div>
        <Button
          onClick={() => {
            setQueue(dueCardIndices.length > 0 ? dueCardIndices : null);
            setPosition(0);
            setLogged(0);
          }}
        >
          Done
        </Button>
      </Card>
    );
  }

  if (!card) return null;

  // Both faces share the card's height (the back is absolutely positioned
  // over the front), so a card with media on either side reserves room for
  // it up front instead of squeezing a back-side image into text height.
  const hasMedia = !!(card.frontMedia?.length || card.backMedia?.length);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Card {position + 1} of {queue.length} due
      </p>
      <div className="flip-perspective">
        <Card
          ref={containerRef}
          role="button"
          tabIndex={0}
          data-flipped={flipped}
          onClick={handleCardClick}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            tap(10);
            setFlipped((f) => !f);
          }}
          className={`flip-card ${hasMedia ? "min-h-[55vh]" : "min-h-40"} cursor-pointer justify-center overflow-visible px-6 py-8 text-lg outline-none hover:shadow-md focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`}
        >
          {/* Each face holds ONLY its own text, so it centers on its own —
              the "Click to..." caption used to live inside these faces and
              compete for vertical space, which is why front/back centering
              looked inconsistent. The caption now lives entirely outside
              the flipping card (below), always in the same place. */}
          <CardContent className="flip-face px-0">
            <CardFace text={card.front} media={card.frontMedia} active={!flipped} />
          </CardContent>
          <CardContent className="flip-face flip-face-back px-0">
            {/* Like Anki's {{FrontSide}}: the back replays the front's media
                (e.g. a video clip next to its answer). Mounted only once
                revealed, so the clip isn't loaded twice before then. */}
            <CardFace
              text={card.back}
              media={flipped ? [...(card.frontMedia ?? []), ...(card.backMedia ?? [])] : []}
              active={flipped}
            />
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        {flipped ? "Click to see front" : "Click to reveal answer"}
      </p>

      <AskAiPanel
        endpoint={`/api/items/${itemId}/ask`}
        containerRef={containerRef}
        getWholeContext={getWholeContext}
        showWholeButtons
      />

      {flipped && (
        <div className="flex flex-wrap gap-2">
          {RESULT_LABELS.map(({ result, label, className }, i) => (
            <Button
              key={result}
              variant="ghost"
              onClick={() => handleResult(result)}
              className={className}
            >
              {label}
              <kbd className="ml-1 rounded border border-current/30 px-1 font-sans text-[0.65rem] opacity-60">
                {i + 1}
              </kbd>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
