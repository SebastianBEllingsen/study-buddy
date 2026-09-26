"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import type { DueFlashcardItem } from "@/lib/models";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// The full due-flashcards list, regardless of how much the dashboard widget
// itself has room to show — opened from either the compact ("just a
// number") or full widget so picking a set to study isn't gated on the
// widget being resized wide enough to show its inline list.
export function DueFlashcardsDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: DueFlashcardItem[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cards due</DialogTitle>
          <DialogDescription>
            Pick a set to study, or{" "}
            <Link href="/review" onClick={() => onOpenChange(false)} className="text-foreground underline">
              review everything that&apos;s due
            </Link>{" "}
            in one mixed session.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.itemId}>
              <Link
                href={`/items/${item.itemId}`}
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
              >
                <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{item.courseName}</span>
                <span className="shrink-0 rounded-full bg-amber/15 px-1.5 py-0.5 text-xs font-medium text-amber">
                  {item.dueCount} due
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
