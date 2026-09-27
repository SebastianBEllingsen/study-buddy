"use client";

import useSWR from "swr";
import { AlertTriangle, Cloud, CloudOff, CloudUpload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDateFormatter } from "@/components/DateFormatProvider";
import type { SyncStatus } from "@/lib/sync/runtime";

// Sync status (lib/sync/), for computers that sync: a small header icon, and
// the fuller panel in Settings → Storage.

type Status = SyncStatus & { enabled: boolean; conflicts: { table_name: string; resolution: string; at: string }[] };

function useSyncStatus() {
  // Polls often while sync is on, rarely otherwise (Settings refreshes it
  // straight away when sync is turned on).
  return useSWR<Status>("/api/sync", { refreshInterval: (latest) => (latest?.enabled ? 10_000 : 60_000) });
}

function describe(status: Status): { label: string; icon: typeof Cloud; tone: string } {
  switch (status.health) {
    case "offline":
      return {
        label: status.pending > 0 ? `Offline — ${status.pending} change(s) will upload when you're back online` : "Offline — working on this computer's copy",
        icon: CloudOff,
        tone: "text-amber",
      };
    case "error":
      return { label: `Sync problem: ${status.error ?? "unknown"}`, icon: AlertTriangle, tone: "text-destructive" };
    case "syncing":
      return { label: "Syncing…", icon: RefreshCw, tone: "text-muted-foreground" };
    case "pending":
      return { label: `${status.pending} change(s) waiting to upload`, icon: CloudUpload, tone: "text-muted-foreground" };
    default:
      return { label: "Synced", icon: Cloud, tone: "text-muted-foreground" };
  }
}

async function syncNow(mutate: () => void) {
  const res = await fetch("/api/sync", { method: "POST" }).catch(() => null);
  if (!res?.ok) toast.error("Couldn't sync");
  mutate();
}

export function SyncIndicator() {
  const { data, mutate } = useSyncStatus();
  if (!data?.enabled) return null;
  const { label, icon: Icon, tone } = describe(data);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={`${label} — click to sync now`}
      onClick={() => void syncNow(() => void mutate())}
      className={tone}
    >
      <Icon className={data.health === "syncing" ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
    </Button>
  );
}

export function SyncPanel() {
  const fmt = useDateFormatter();
  const { data, mutate } = useSyncStatus();
  if (!data?.enabled) return null;
  const { label, icon: Icon, tone } = describe(data);
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 ${tone}`}>
          <Icon className="size-4" />
          {label}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void syncNow(() => void mutate())}>
          Sync now
        </Button>
      </div>
      {data.lastSyncedAt && (
        <p className="text-xs text-muted-foreground">Last synced {fmt.dateTime(new Date(data.lastSyncedAt))}</p>
      )}
      {data.conflicts.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {data.conflicts.length} recent conflict(s) — edits made on both computers
          </summary>
          <ul className="mt-1 space-y-0.5">
            {data.conflicts.map((c, i) => (
              <li key={i}>
                {fmt.dateTime(new Date(`${c.at.replace(" ", "T")}Z`))} · {c.table_name.replace(/_/g, " ")}: {c.resolution}
              </li>
            ))}
          </ul>
          <p className="mt-1">Notes and canvases are never overwritten: the other version is kept as a &quot;conflicted copy&quot;.</p>
        </details>
      )}
    </div>
  );
}
