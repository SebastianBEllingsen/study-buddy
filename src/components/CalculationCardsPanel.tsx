"use client";

import { useState } from "react";
import type { Flashcard } from "@/lib/types";
import { calculationCardIndices } from "@/lib/flashcards/calculationCards";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

// A deck's calculation-style cards ("Compute…", "Solve…"): they belong in
// quizzes and problem sets, not flashcards. Lists them for the student to
// confirm, then removes the ones they keep ticked.
export function CalculationCardsPanel({
  cards,
  onRemove,
}: {
  cards: Flashcard[];
  onRemove: (remaining: Flashcard[], removedIndices: number[]) => Promise<boolean>;
}) {
  const found = calculationCardIndices(cards);
  const [open, setOpen] = useState(false);
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  if (found.length === 0) return null;

  const removing = found.filter((i) => !unticked.has(i));

  async function remove() {
    setBusy(true);
    try {
      const gone = new Set(removing);
      if (await onRemove(cards.filter((_, i) => !gone.has(i)), removing)) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          {found.length} card{found.length === 1 ? " looks" : "s look"} like a calculation, not something to remember —
          those work better as quiz questions.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Review"}
        </Button>
      </div>
      {open && (
        <>
          <ul className="divide-y divide-border/60">
            {found.map((i) => (
              <li key={i} className="flex items-start gap-2 py-1.5">
                <Checkbox
                  checked={!unticked.has(i)}
                  onCheckedChange={(v) =>
                    setUnticked((prev) => {
                      const next = new Set(prev);
                      if (v) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  aria-label={`Remove card ${i + 1}`}
                  className="mt-0.5"
                />
                <span className="min-w-0 break-words">{cards[i].front.replace(/<[^>]+>/g, " ")}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button size="sm" variant="destructive" disabled={busy || removing.length === 0} onClick={() => void remove()}>
              Remove {removing.length} card{removing.length === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
