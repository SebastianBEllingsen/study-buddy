"use client";

import { useRef, useState } from "react";

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AskTurn {
  question: string;
  answer: string;
}

const MIN_CROP_SIZE = 8;

/**
 * Shared drag-a-rectangle-then-ask-AI-about-it state machine — used by
 * PdfViewer (crops straight off the rendered page's own <canvas>) and any
 * other content view (rasterized via html2canvas — see cropCapture.ts)
 * that already offers AskAiPanel-style text-selection asking. All
 * coordinates are viewport (client) coordinates throughout, so dragging
 * works the same regardless of the container's own scroll position — the
 * live selection box itself is rendered through a portal (see
 * CropToAskUI.tsx's CropSelectionOverlay) rather than relying on plain
 * `position: fixed`, since a fixed-position element inside an ancestor with
 * a CSS transform (e.g. Dialog's centering transform) is positioned
 * relative to THAT ancestor, not the real viewport — which is what caused
 * the selection box to visibly drift from the cursor inside dialogs.
 *
 * A finished drag doesn't ask immediately: `captureRegion` produces a
 * preview (`pending`), and the caller confirms (optionally adding a
 * question, via `confirmAsk`) or cancels before anything is sent.
 *
 * Once the first answer comes back, the same cropped image stays "live" —
 * `askFollowUp` sends another question about it, with every prior turn
 * folded into the prompt server-side (see askImageUserPrompt) and the image
 * itself re-sent alongside each time, since none of the six generateText
 * backends keep any state between calls. `turns` accumulates the whole
 * thread; `dismiss` drops it and the image, back to no crop in progress.
 *
 * `captureRegion` turns a finished drag rectangle into a data URL (or null
 * if there's nothing sensible to crop there) — the one thing that differs
 * between call sites.
 */
export function useCropToAsk(
  askEndpoint: string,
  captureRegion: (rect: CropRect) => Promise<string | null>
) {
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function toggleCropMode() {
    setCropMode((prev) => !prev);
    startRef.current = null;
    setCropRect(null);
    setPending(null);
    setQuestion("");
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (!cropMode) return;
    // Prevents a native text selection from also starting underneath the drag.
    e.preventDefault();
    startRef.current = { x: e.clientX, y: e.clientY };
    setCropRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
  }

  function handleMouseMove(e: React.MouseEvent) {
    const start = startRef.current;
    if (!start) return;
    setCropRect({
      left: Math.min(start.x, e.clientX),
      top: Math.min(start.y, e.clientY),
      width: Math.abs(e.clientX - start.x),
      height: Math.abs(e.clientY - start.y),
    });
  }

  async function handleMouseUp() {
    const rect = cropRect;
    startRef.current = null;
    setCropRect(null);
    setCropMode(false);
    if (!rect || rect.width < MIN_CROP_SIZE || rect.height < MIN_CROP_SIZE) return;

    const dataUrl = await captureRegion(rect);
    if (dataUrl) setPending(dataUrl);
  }

  // Shared by confirmAsk (first turn — question may be blank, falling back
  // to a generic "explain this" server-side) and askFollowUp (question
  // required — nothing to send otherwise). `forImage`/`priorTurns` are
  // captured by the caller rather than read from state here, since state
  // set just before calling this wouldn't be visible yet within the same
  // event handler.
  async function send(forImage: string, q: string, priorTurns: AskTurn[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(askEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "explain",
          image: forImage,
          question: q || undefined,
          priorTurns: priorTurns.length > 0 ? priorTurns : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }
      setTurns((prev) => [
        ...prev,
        { question: q || "Explain what's shown in this image.", answer: body.answer },
      ]);
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function confirmAsk() {
    if (!pending) return;
    const forImage = pending;
    const q = question.trim();
    setImage(forImage);
    setPending(null);
    setQuestion("");
    send(forImage, q, []);
  }

  function askFollowUp() {
    const q = question.trim();
    if (!q || !image || loading) return;
    setQuestion("");
    send(image, q, turns);
  }

  function cancelPending() {
    setPending(null);
    setQuestion("");
  }

  function dismiss() {
    setImage(null);
    setTurns([]);
    setError(null);
    setQuestion("");
  }

  return {
    cropMode,
    cropRect,
    toggleCropMode,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    pending,
    question,
    setQuestion,
    confirmAsk,
    cancelPending,
    image,
    turns,
    askFollowUp,
    loading,
    error,
    dismiss,
  };
}
