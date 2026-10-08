"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { RowActionsMenu, type RowAction } from "@/components/RowActionsMenu";
import { Checkbox } from "@/components/ui/checkbox";
import type { StudyPlan } from "@/lib/studyPlan/types";

// The "⋯" menu of a study plan, with its delete: the plan goes, and — if
// ticked — the quizzes, flashcards and notes made for its chapters go too,
// along with their reviews and mistakes (so they leave Today as well).
export function DeleteStudyPlanMenu({
  plan,
  actions,
  onDeleted,
}: {
  plan: Pick<StudyPlan, "id" | "chapters">;
  actions?: RowAction[];
  onDeleted: () => void | Promise<void>;
}) {
  const { mutate } = useSWRConfig();
  const [deleteItems, setDeleteItems] = useState(false);
  const itemCount = plan.chapters.reduce((n, c) => n + c.items.length, 0);

  async function handleDelete() {
    const res = await fetch(`/api/study-plans/${plan.id}${deleteItems ? "?deleteItems=1" : ""}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      toast.error("Couldn't delete the plan");
      return;
    }
    setDeleteItems(false);
    // Reviews, mistakes and item lists may have changed everywhere.
    await mutate((key) => typeof key === "string" && key.startsWith("/api/"));
    await onDeleted();
  }

  return (
    <RowActionsMenu
      ariaLabel="Study plan actions"
      actions={actions}
      deleteLabel="Delete study plan"
      deleteDescription="Deletes the plan, its checklists and its links. Course documents aren't touched."
      deleteExtra={
        itemCount > 0 ? (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={deleteItems} onCheckedChange={(v) => setDeleteItems(!!v)} />
            <span>
              Also delete the {itemCount} quiz, flashcard and notes {itemCount === 1 ? "item" : "items"} made for its
              chapters, with their reviews and mistakes.
            </span>
          </label>
        ) : null
      }
      onDelete={handleDelete}
    />
  );
}
