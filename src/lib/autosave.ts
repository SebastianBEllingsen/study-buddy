"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

// Autosave for an edited document (a note, a canvas): edits are batched for
// a moment, then PATCHed — one request at a time, so saves can't land out of
// order and put older text back. A save that fails on a network or server
// error keeps its edits and retries; closing the tab flushes what's left
// (and asks first if that can't be guaranteed).

export type SaveState = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 800;
const MAX_RETRY_MS = 30_000;
// Browsers refuse keepalive request bodies over 64 KB.
const KEEPALIVE_LIMIT = 60_000;

export class Autosave<F extends Record<string, unknown>> {
  private pending: Partial<F> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private failures = 0;

  constructor(
    private url: string,
    private failMessage: string,
    private onState: (state: SaveState) => void
  ) {}

  // Unsent edits, or a save still on its way.
  get dirty(): boolean {
    return this.sending || Object.keys(this.pending).length > 0;
  }

  schedule = (fields: Partial<F>) => {
    this.pending = { ...this.pending, ...fields };
    this.onState("saving");
    this.arm(DEBOUNCE_MS);
  };

  // Drops unsent edits — the document is being deleted.
  discard = () => {
    this.clearTimer();
    this.pending = {};
  };

  // Sends whatever is waiting now (leaving the page within the app).
  flush = () => {
    if (Object.keys(this.pending).length > 0) this.arm(0);
  };

  // The tab is closing: a normal request would be cancelled, so send what
  // fits in a keepalive request. Returns false when something couldn't be.
  flushOnUnload = (): boolean => {
    if (Object.keys(this.pending).length === 0) return !this.sending;
    const body = JSON.stringify(this.pending);
    if (body.length > KEEPALIVE_LIMIT) return false;
    this.clearTimer();
    this.pending = {};
    fetch(this.url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
      () => {}
    );
    return !this.sending;
  };

  private arm(delay: number) {
    this.clearTimer();
    this.timer = setTimeout(() => void this.send(), delay);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async send() {
    this.timer = null;
    // One at a time: whatever arrives meanwhile goes out after this one.
    if (this.sending) return;
    const fields = this.pending;
    if (Object.keys(fields).length === 0) return;
    this.pending = {};
    this.sending = true;

    let status: "ok" | "retry" | "rejected" = "retry";
    let error: string | undefined;
    try {
      const res = await fetch(this.url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (res.ok) status = "ok";
      else if (res.status < 500) {
        status = "rejected";
        error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      }
    } catch {
      // Network error: retry.
    }
    this.sending = false;

    if (status === "retry") {
      // Keep the edits — newer ones made meanwhile win over these.
      this.pending = { ...fields, ...this.pending };
      this.failures++;
      if (this.failures === 1) toast.error(`${this.failMessage} — retrying`);
      this.onState("error");
      this.arm(Math.min(1000 * 2 ** this.failures, MAX_RETRY_MS));
      return;
    }
    if (status === "rejected") {
      // The server turned these down (e.g. the note was deleted); sending
      // them again won't help.
      toast.error(error ?? this.failMessage);
    } else if (this.failures > 0) {
      toast.success("Saved");
    }
    this.failures = 0;
    if (Object.keys(this.pending).length > 0) this.arm(DEBOUNCE_MS);
    else this.onState(status === "ok" ? "saved" : "idle");
  }
}

// One Autosave per URL, flushed when the page closes or the URL changes.
export function useAutosave<F extends Record<string, unknown>>(url: string, failMessage: string) {
  const [state, setState] = useState<SaveState>("idle");
  const saver = useMemo(() => new Autosave<F>(url, failMessage, setState), [url, failMessage]);

  useEffect(() => {
    const onPageHide = () => saver.flushOnUnload();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saver.flushOnUnload()) event.preventDefault();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      saver.flush();
    };
  }, [saver]);

  return { schedule: saver.schedule, discard: saver.discard, state };
}

export function saveStateLabel(state: SaveState): string {
  return state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved yet — retrying" : "";
}
