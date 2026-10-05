"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import { Checkbox } from "@/components/ui/checkbox";
import type { ExplainSession } from "@/lib/explain/types";

// The "⋯" menu of a blurt / "explain it" session, with its delete. The
// flashcards the session added to the course's gap deck stay unless the
// box is ticked, since they may already be part of your reviews.
export function DeleteExplainSession({
  session,
  onDeleted,
}: {
  session: Pick<ExplainSession, "id" | "kind" | "practice_item_id" | "result">;
  onDeleted?: () => void | Promise<void>;
}) {
  const { mutate } = useSWRConfig();
  const [deleteCards, setDeleteCards] = useState(false);
  const cardCount = session.practice_item_id !== null ? (session.result?.cards.length ?? 0) : 0;
  const label = session.kind === "blurt" ? "Delete blurt" : "Delete explanation";

  async function handleDelete() {
    const res = await fetch(`/api/explain-sessions/${session.id}${deleteCards && cardCount > 0 ? "?deleteCards=1" : ""}`, {
      method: "DELETE",
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't delete this session");
      return;
    }
    const removed: number = body.removedCards ?? 0;
    if (!deleteCards || cardCount === 0) toast.success("Session deleted");
    else if (removed === cardCount) toast.success(`Session and ${removed} ${removed === 1 ? "card" : "cards"} deleted`);
    else toast.success(`Session deleted. ${removed} of ${cardCount} cards removed — the rest were edited, so they stayed.`);
    setDeleteCards(false);
    // Cards, reviews and the history list may have changed everywhere; the
    // deleted session's own page is left alone (it would just 404).
    await mutate((key) => typeof key === "string" && key.startsWith("/api/") && key !== `/api/explain-sessions/${session.id}`);
    await onDeleted?.();
  }

  return (
    <RowActionsMenu
      ariaLabel="Session actions"
      deleteLabel={label}
      deleteDescription="Removes this session and its feedback. This can't be undone."
      deleteExtra={
        cardCount > 0 ? (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={deleteCards} onCheckedChange={(v) => setDeleteCards(!!v)} />
            <span>
              Also delete the {cardCount} {cardCount === 1 ? "flashcard" : "flashcards"} it added to your Gap cards deck,
              with their review history. Cards you&apos;ve edited since stay.
            </span>
          </label>
        ) : null
      }
      onDelete={handleDelete}
    />
  );
}
