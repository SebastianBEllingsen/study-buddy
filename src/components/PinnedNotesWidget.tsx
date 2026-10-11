"use client";

import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Pin, PinOff } from "lucide-react";
import { cn } from "cn";
import type { PinnedNote } from "@/lib/models";
import { noteSnippet } from "@/lib/noteSnippet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The dashboard's Pinned notes widget: vault notes pinned from the note's own
// Pin button, most recently pinned first, each linking to the note.
export default function PinnedNotesWidget({
  layout,
  label,
  transparent,
}: {
  layout: { colSpan: number; rowSpan: number };
  label?: string;
  transparent: boolean;
}) {
  const { data, error: fetchError, mutate } = useSWR<{ notes: PinnedNote[] }>("/api/notes/pinned");
  const list = data?.notes ?? null;
  const error = fetchError instanceof Error ? fetchError.message : null;
  const compact = layout.colSpan <= 2 || layout.rowSpan === 1;

  async function unpin(note: PinnedNote) {
    await mutate(
      async () => {
        const res = await fetch(`/api/notes/${note.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: false }),
        });
        if (!res.ok) throw new Error("Couldn't unpin that note");
        return undefined;
      },
      {
        optimisticData: (current) => ({ notes: (current?.notes ?? []).filter((n) => n.id !== note.id) }),
        rollbackOnError: true,
        populateCache: false,
        revalidate: true,
      }
    ).catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't unpin that note"));
  }

  if (compact) {
    const first = list?.[0];
    return (
      <Card
        elevation={transparent ? "flat" : "raised"}
        className={cn("h-full items-center justify-center gap-1 overflow-hidden p-2 text-center", transparent && "backdrop-legible")}
      >
        <Pin className="size-5 text-focus" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && list === null && <Skeleton className="h-4 w-16 rounded" />}
        {!error && list && !first && <p className="text-xs text-muted-foreground">No pinned notes.</p>}
        {!error && first && (
          <Link href={`/vault/${first.id}`} className="w-full hover:underline">
            <p className="truncate text-sm font-medium">{first.title}</p>
            <p className="text-xs text-muted-foreground">
              {list!.length > 1 ? `+${list!.length - 1} more` : first.course_name}
            </p>
          </Link>
        )}
      </Card>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-xl ${transparent ? "backdrop-legible" : "bg-card ring-1 ring-foreground/10"}`}>
      <div className={`flex shrink-0 items-center justify-between gap-2 px-4 py-2.5 ${transparent ? "" : "border-b"}`}>
        <span className="flex items-center gap-1.5 font-heading text-sm font-semibold">
          <Pin className="size-4 text-focus" />
          {label ?? "Pinned notes"}
        </span>
      </div>
      <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {!error && list === null && (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 rounded-md" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        )}
        {!error && list && list.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nothing pinned — open a note and use its Pin button to keep it here.
          </p>
        )}
        {!error && list && list.length > 0 && (
          <ul className="divide-y">
            {list.map((note) => {
              const snippet = layout.rowSpan > 2 ? noteSnippet(note.markdown) : "";
              return (
                <li key={note.id} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted/40">
                  <Link href={`/vault/${note.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0">{note.icon ?? "🗒️"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{note.title || "Untitled"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {snippet ? `${note.course_name} · ${snippet}` : note.course_name}
                      </span>
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Unpin ${note.title}`}
                    onClick={() => void unpin(note)}
                  >
                    <PinOff className="size-3.5 text-muted-foreground" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
