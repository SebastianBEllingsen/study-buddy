"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Flashcard } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// A correction tool for existing cards, not a card authoring UI — edit
// front/back text or drop a card entirely, nothing more. Adding new cards
// belongs with generation (regenerate/supplement), not here.
// Pairs each draft card with its index in the ORIGINAL `cards` prop —
// review state is keyed by that positional index (see
// reconcileReviewItemsAfterRemoval in lib/review/store.ts), so removing a
// card here needs to report which original index(es) disappeared, not just
// hand back a shorter array and leave every later card's schedule state
// silently misattributed to the wrong card.
interface DraftCard {
  originalIndex: number;
  card: Flashcard;
}

export default function EditFlashcardsDialog({
  open,
  onOpenChange,
  cards,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: Flashcard[];
  onSave: (cards: Flashcard[], removedIndices: number[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<DraftCard[]>(() => cards.map((card, originalIndex) => ({ originalIndex, card })));
  const [saving, setSaving] = useState(false);
  // Tracks the open/closed transition during render (React's documented
  // pattern for "reset state when a prop changes") rather than an effect —
  // re-seeds the draft from the latest saved cards each time the dialog
  // opens, so reopening after a save (or after cancelling) never shows
  // stale edits from a previous session.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(cards.map((card, originalIndex) => ({ originalIndex, card })));
  }

  function updateCard(index: number, field: "front" | "back", value: string) {
    setDraft((prev) =>
      prev.map((d, i) => (i === index ? { ...d, card: { ...d.card, [field]: value } } : d))
    );
  }

  function removeCard(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const survivingIndices = new Set(draft.map((d) => d.originalIndex));
      const removedIndices = cards
        .map((_, i) => i)
        .filter((i) => !survivingIndices.has(i));
      if (await onSave(draft.map((d) => d.card), removedIndices)) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit cards</DialogTitle>
          <DialogDescription>
            Fix a card the AI got wrong, or remove one entirely. Changes apply to every future
            review of this set.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {draft.map((d, i) => (
            <div key={d.originalIndex} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Card {i + 1}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove card ${i + 1}`}
                  onClick={() => removeCard(i)}
                >
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Front</Label>
                <Textarea
                  rows={2}
                  value={d.card.front}
                  onChange={(e) => updateCard(i, "front", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Back</Label>
                <Textarea
                  rows={2}
                  value={d.card.back}
                  onChange={(e) => updateCard(i, "back", e.target.value)}
                />
              </div>
            </div>
          ))}
          {draft.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No cards left — cancel to keep the original set.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || draft.length === 0}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
