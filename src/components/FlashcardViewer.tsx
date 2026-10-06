"use client";

import { Explain } from "@/components/Explain";
import { useEffect, useRef, useState } from "react";
import { PartyPopper, CalendarCheck } from "lucide-react";
import { saveInBackground } from "@/lib/backgroundSaves";
import type { Flashcard } from "@/lib/types";
import type { FlashcardResult } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AskAiPanel } from "@/components/ask-ai/AskAiPanel";
import { CardFace } from "@/components/CardFace";
import { cardFaces } from "@/lib/cardFaces";
import { Badge } from "@/components/ui/badge";
import { tap } from "@/lib/haptics";
import { CONFIDENCES, type Confidence } from "@/lib/review/types";
import { ConfidencePicker } from "@/components/review/ConfidencePicker";
import { WhyPrompt } from "@/components/review/WhyPrompt";
import { ReportWrongButton } from "@/components/sources/ReportWrongButton";
import { SourceLink } from "@/components/sources/SourceLink";

// Colors span the same recall-confidence gradient used everywhere else in
// the app: Clay (forgot) → Amber (struggled) → Sage (got it) → Focus
// (mastered) — not an unrelated red/orange/green/blue set.
const RESULT_LABELS: { result: FlashcardResult; label: string; className: string }[] = [
  { result: "again", label: "Again", className: "bg-clay/10 text-clay hover:bg-clay/20" },
  { result: "hard", label: "Hard", className: "bg-amber/10 text-amber hover:bg-amber/20" },
  { result: "good", label: "Good", className: "bg-sage/10 text-sage hover:bg-sage/20" },
  { result: "easy", label: "Easy", className: "bg-focus/10 text-focus hover:bg-focus/20" },
];

export function handleFlashcardKeyDown({
  event,
  flipped,
  onFlip,
  onRate,
  onConfidence,
}: {
  event: KeyboardEvent;
  flipped: boolean;
  onFlip: () => void;
  onRate: (result: FlashcardResult) => void;
  // Before the reveal, 1–3 pick a confidence (and reveal) when given.
  onConfidence?: (confidence: Confidence) => void;
}) {
  const target = event.target as HTMLElement | null;
  const isTypingTarget =
    !!target &&
    ((target.tagName === "INPUT" || target.tagName === "TEXTAREA") || target.isContentEditable);
  if (isTypingTarget) return false;

  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    onFlip();
    return true;
  }

  if (!flipped) {
    const confidence = CONFIDENCES[["1", "2", "3"].indexOf(event.key)];
    if (!onConfidence || !confidence) return false;
    event.preventDefault();
    onConfidence(confidence);
    return true;
  }

  const index = ["1", "2", "3", "4"].indexOf(event.key);
  if (index === -1) return false;
  event.preventDefault();
  onRate(RESULT_LABELS[index].result);
  return true;
}

// One card to study in a session — regular, or back-first.
interface Turn {
  index: number;
  reverse: boolean;
}

// Regular turns first-to-last, with each back-first turn dropped in at a
// random spot — but never straight after (or before) its own card's regular
// turn, which would hand over the answer.
export function mixTurns(regular: number[], reverse: number[], random: () => number = Math.random): Turn[] {
  const turns: Turn[] = regular.map((index) => ({ index, reverse: false }));
  for (const index of reverse) {
    for (let attempt = 0; ; attempt++) {
      const at = Math.floor(random() * (turns.length + 1));
      const clashes = [turns[at - 1], turns[at]].some((t) => t?.index === index);
      if (clashes && attempt < 20) continue;
      turns.splice(at, 0, { index, reverse: true });
      break;
    }
  }
  return turns;
}

export default function FlashcardViewer({
  itemId,
  cards,
  dueCardIndices,
  dueReverseIndices = [],
  onFlagged,
}: {
  itemId: number;
  cards: Flashcard[];
  dueCardIndices: number[];
  // Cards due back-first (the deck's "reverse" setting); mixed in at random.
  dueReverseIndices?: number[];
  // A card was reported wrong (and so left this session).
  onFlagged?: () => void;
}) {
  // The queue of card indices for this session — due cards by default, or
  // every card if the student explicitly asks to cram ahead of schedule.
  const [queue, setQueue] = useState<Turn[] | null>(() =>
    dueCardIndices.length + dueReverseIndices.length > 0 ? mixTurns(dueCardIndices, dueReverseIndices) : null
  );
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [logged, setLogged] = useState(0);
  // Tapped before the reveal; sent with the rating, reset per card.
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const done = queue !== null && position >= queue.length;
  const turn = queue?.[position];
  const cardIndex = turn?.index;
  const reverse = turn?.reverse ?? false;
  const card = cardIndex != null ? cards[cardIndex] : undefined;

  // Only the side being asked, unless the other has actually been revealed —
  // matches what's currently on screen, same principle as the quiz side.
  function getWholeContext() {
    if (!card) return "";
    const faces = cardFaces(card, reverse);
    return flipped ? `${card.front}\n\n${card.back}` : faces.prompt.text;
  }

  function handleCardClick() {
    // Don't flip if the click is the tail end of a text-selection drag.
    if (window.getSelection()?.toString().trim()) return;
    tap(10);
    setFlipped((f) => !f);
  }

  // Moves on at once; the rating is saved in the background.
  function handleResult(result: FlashcardResult) {
    if (cardIndex == null) return;
    saveInBackground(
      `/api/items/${itemId}/review`,
      { cardIndex, result, confidence, ...(reverse && { reverse: true }) },
      "Couldn't save a card rating — it'll come up again next review"
    );
    setLogged((n) => n + 1);
    setFlipped(false);
    setConfidence(null);
    setPosition((p) => p + 1);
  }

  function revealWith(value: Confidence) {
    tap(10);
    setConfidence(value);
    setFlipped(true);
  }

  // Space flips the card; 1-3 before the reveal say how sure you are (and
  // reveal); 1-4 after it rate the revealed card (Again/Hard/Good/Easy,
  // left to right — matches RESULT_LABELS). This keeps the card review loop
  // fast without hijacking text entry in forms or the Ask AI panel.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      handleFlashcardKeyDown({
        event: e,
        flipped,
        onFlip: () => setFlipped((f) => !f),
        onRate: handleResult,
        onConfidence: revealWith,
      });
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
            setQueue(cards.flatMap((c, i) => (c.flag ? [] : [{ index: i, reverse: false }])));
            setPosition(0);
          }}
        >
          Review all {cards.filter((c) => !c.flag).length} cards anyway
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
            // dueCardIndices is from page load and now stale — everything in
            // it was just reviewed, so land on "all caught up", not a replay.
            setQueue(null);
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
  const faces = cardFaces(card, reverse);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Card {position + 1} of {queue.length} due
        {reverse && (
          <Badge variant="outline" className="ml-2">
            Reverse
          </Badge>
        )}
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
            <CardFace text={faces.prompt.text} media={faces.prompt.media} active={!flipped} />
          </CardContent>
          <CardContent className="flip-face flip-face-back px-0">
            {/* Like Anki's {{FrontSide}}: the back replays the front's media
                (e.g. a video clip next to its answer). Mounted only once
                revealed, so the clip isn't loaded twice before then. */}
            <CardFace
              text={faces.answer.text}
              media={flipped ? faces.answer.media : []}
              active={flipped}
            />
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {flipped ? "Click to see the other side" : "Click to reveal answer"}
        </p>
        <ConfidencePicker value={confidence} onChange={revealWith} disabled={flipped} shortcuts={!flipped} />
      </div>

      <AskAiPanel
        endpoint={`/api/items/${itemId}/ask`}
        containerRef={containerRef}
        getWholeContext={getWholeContext}
        showWholeButtons
      />

      {flipped && cardIndex != null && <WhyPrompt key={cardIndex} itemId={itemId} cardIndex={cardIndex} />}

      {flipped && cardIndex != null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {card.source ? <SourceLink source={card.source} /> : <span />}
          <ReportWrongButton
            key={cardIndex}
            itemId={itemId}
            index={cardIndex}
            onReported={() => {
              setFlipped(false);
              setConfidence(null);
              setPosition((p) => p + 1);
              onFlagged?.();
            }}
          />
        </div>
      )}

      {flipped && (
        <div className="flex flex-wrap gap-2">
          {RESULT_LABELS.map(({ result, label, className }, i) => (
            <Explain key={result} id={`rating.${result}`}>
              <Button variant="ghost" onClick={() => handleResult(result)} className={className}>
                {label}
                <kbd className="ml-1 rounded border border-current/30 px-1 font-sans text-[0.65rem] opacity-60">
                  {i + 1}
                </kbd>
              </Button>
            </Explain>
          ))}
        </div>
      )}
    </div>
  );
}
