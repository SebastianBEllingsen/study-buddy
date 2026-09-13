"use client";

import { useState } from "react";

export type AskKind = "hint" | "explain";

// endpoint is the full ask route to POST to — e.g. `/api/items/:id/ask` or
// `/api/courses/:courseId/documents/:documentId/ask` — so this hook stays
// agnostic to what's being asked about.
export function useAskAi(endpoint: string) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json();
      if (!res.ok) {
        setError(resBody.error ?? "Something went wrong");
        return;
      }
      setAnswer(resBody.answer);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function ask(kind: AskKind, context: string, selection?: string) {
    return post({ kind, context, selection });
  }

  // Screenshot-crop-to-ask (see useCropToAsk.ts) — always "explain", since a
  // cropped image has no question of its own to hint toward. `question` is
  // the optional free-text question typed into the crop preview before
  // sending; omitted, the server falls back to a generic "explain this".
  function askImage(image: string, question?: string) {
    return post({ kind: "explain", image, question });
  }

  function dismiss() {
    setAnswer(null);
    setError(null);
  }

  return { ask, askImage, loading, answer, error, dismiss };
}
