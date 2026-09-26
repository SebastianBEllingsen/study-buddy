"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import { toast } from "sonner";
import { HelpCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MathText } from "@/components/MathText";

// "Why?" under a revealed card: say why the answer is true (optional), and
// get feedback plus the reasoning behind it. Asking why turns a memorised
// fact into an understood one. Mount with a key per card so it resets.
export function WhyPrompt({ itemId, cardIndex }: { itemId: number; cardIndex: number }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ feedback: string | null; explanation: string } | null>(null);

  async function ask() {
    setBusy(true);
    const res = await fetch(`/api/items/${itemId}/why`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardIndex, attempt }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't explain that");
      return;
    }
    setResult(body);
  }

  if (!open) {
    return (
      <Explain id="card.why">
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setOpen(true)}>
          <HelpCircle className="size-3.5" />
          Why?
        </Button>
      </Explain>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border px-3 py-3" onKeyDown={(e) => e.stopPropagation()}>
      {result ? (
        <div className="space-y-2 text-sm">
          {result.feedback && (
            <p className="text-muted-foreground">
              <MathText text={result.feedback} />
            </p>
          )}
          <p className="whitespace-pre-line">
            <MathText text={result.explanation} />
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Why is this true? Say it in your own words first — or just ask.</p>
          <Textarea rows={2} value={attempt} onChange={(e) => setAttempt(e.target.value)} placeholder="Because…" />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void ask()}>
            {busy && <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />}
            {attempt.trim() ? "Check my reasoning" : "Explain why"}
          </Button>
        </>
      )}
    </div>
  );
}
