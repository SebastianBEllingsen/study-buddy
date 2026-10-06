"use client";

import { useState } from "react";
import useSWR from "swr";
import { CloudOff } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Shown on every page while the app couldn't reach its Supabase database and
// is working on this computer's own copy instead (lib/db/index.ts falls back
// rather than failing, so the app still opens). Without this the fallback is
// invisible: your cloud data looks gone, and anything you change goes to a
// file the cloud never sees.

type StorageStatus = { connectionError: string | null };

export function StorageFallbackBanner() {
  // Checked again every so often while it's down, so the banner doesn't
  // linger once the problem is fixed elsewhere.
  const { data, mutate } = useSWR<StorageStatus>("/api/storage-settings", {
    refreshInterval: (latest) => (latest?.connectionError ? 30_000 : 0),
  });
  const [retrying, setRetrying] = useState(false);

  if (!data?.connectionError) return null;

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch("/api/storage-settings/reconnect", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && body?.ok) {
        toast.success("Reconnected to your Supabase database");
        // The app is now looking at different data — reload what's on screen.
        window.location.reload();
        return;
      }
      toast.error("Still can't reach it");
    } catch {
      toast.error("Still can't reach it");
    } finally {
      setRetrying(false);
      void mutate();
    }
  }

  return (
    <div className="mx-auto mt-3 w-full max-w-5xl px-4 sm:px-6">
      <Alert variant="destructive">
        <CloudOff />
        <AlertTitle>Can&apos;t reach your cloud database</AlertTitle>
        <AlertDescription>
          <p>
            You&apos;re seeing the copy on this computer, not your Supabase data, and anything you change now stays here.
            Check your connection, or the connection string in Settings → Storage.
          </p>
          <p className="mt-1 break-words text-xs opacity-80">{data.connectionError}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" disabled={retrying} onClick={() => void retry()}>
            {retrying ? "Trying…" : "Try again"}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
