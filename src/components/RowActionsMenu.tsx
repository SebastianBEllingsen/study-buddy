"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontal, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// The single "⋯" affordance every list row/card in the app opens for its
// edit-ish actions (rename, customize, delete, …) — replaces what used to
// be a different-looking cluster of 2-3 standalone icon buttons per
// component (a palette here, a pencil there, each with its own hit target
// and hover state). One trigger, one small panel, everywhere: `children`
// holds anything richer than a plain action (an icon/color picker, say),
// `actions` is the plain "click it, it happens, panel closes" list, and
// `onDelete` — kept separate rather than just another action — always gets
// the same destructive styling, bottom placement, and confirm step.
export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

export interface RowActionsMenuProps {
  ariaLabel: string;
  children?: ReactNode;
  actions?: RowAction[];
  onDelete?: () => Promise<void> | void;
  deleteLabel?: string;
  deleteDescription?: string;
  // Overrides the trigger icon's color — e.g. a card that renders its own
  // cover photo as a background needs a light icon to stay legible, same as
  // the other icons drawn over that photo.
  triggerIconClassName?: string;
  // Swaps the "⋯" for a different glyph — e.g. a folder's own "add content"
  // trigger reuses this exact popover shell (same panel, same row styling)
  // but reads as "+" rather than "more actions", since it opens a menu of
  // things to add rather than edit.
  triggerIcon?: LucideIcon;
  contentClassName?: string;
}

export function RowActionsMenu({
  ariaLabel,
  children,
  actions = [],
  onDelete,
  deleteLabel = "Delete",
  deleteDescription = "This can't be undone.",
  triggerIconClassName = "text-muted-foreground",
  triggerIcon: TriggerIcon = MoreHorizontal,
  contentClassName,
}: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const hasLeadingContent = !!children || actions.length > 0;

  async function handleConfirmDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={ariaLabel}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <TriggerIcon className={cn("size-3.5", triggerIconClassName)} />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className={cn("w-56 space-y-1 p-1.5", contentClassName)}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.length > 0 && (
            <div className="space-y-0.5">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <action.icon className="size-3.5 shrink-0 text-muted-foreground" />
                  {action.label}
                </button>
              ))}
            </div>
          )}
          {children}
          {onDelete && (
            <div className={cn(hasLeadingContent && "mt-1 border-t pt-1")}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirmOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5 shrink-0" />
                {deleteLabel}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {onDelete && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{deleteLabel}?</AlertDialogTitle>
              <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleConfirmDelete}>
                {deleting ? "Deleting…" : deleteLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
