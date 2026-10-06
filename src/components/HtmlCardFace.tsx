"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import useSWR from "swr";
import type { AppSettings } from "@/lib/models";
import { buildCardDocument, frameKeyPress, type CardFrameMessage } from "@/lib/cardHtml";
import type { CardHtml } from "@/lib/types";

// One side of a card imported from Anki, drawn the way Anki draws it: the
// note type's HTML and CSS, scripts running, in a frame that can't reach the
// app (no same-origin access, no network requests — see lib/cardHtml.ts).
// `active` is whether this face is the one showing; a face turned away
// pauses its audio/video, and one turned back to starts it again.
export function HtmlCardFace({
  card,
  side,
  active,
  onFlip,
}: {
  card: CardHtml;
  side: "front" | "back";
  active: boolean;
  // A click on the card's own background (not on a link, button or clip)
  // flips it, as clicking anywhere on a plain card does.
  onFlip?: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const sequence = settings?.flashcardAudioAutoplay === "sequence";
  const dark = resolvedTheme === "dark";
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  // Only the face showing when the frame first loads starts its audio;
  // later changes arrive as messages (below).
  const [autoplay] = useState(active);
  // Null while server-rendering/hydrating; the frame is only built in the browser.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => null
  );
  const textColor = dark ? "#f4f4f5" : "#18181b";
  const [height, setHeight] = useState(0);
  const onFlipRef = useRef(onFlip);
  useEffect(() => {
    onFlipRef.current = onFlip;
  });

  useEffect(() => {
    function onMessage(e: MessageEvent<CardFrameMessage>) {
      if (e.source !== frameRef.current?.contentWindow) return;
      const m = e.data;
      if (!m || m.sb !== channel) return;
      if (m.kind === "height" && Number.isFinite(m.height)) setHeight(Math.min(Math.max(m.height, 0), 20000));
      else if (m.kind === "flip") onFlipRef.current?.();
      else if (m.kind === "key") {
        // Keys pressed inside the frame go to the same shortcuts as keys
        // pressed on the page (space flips, 1–4 rate) — and only those.
        const press = frameKeyPress(m.key);
        if (press) document.dispatchEvent(new KeyboardEvent("keydown", { ...press, bubbles: true, cancelable: true }));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ sb: channel, kind: "active", value: active }, "*");
  }, [active, channel]);

  const srcDoc =
    origin === null
      ? ""
      : buildCardDocument({
          html: side === "front" ? card.front : card.back,
          css: card.css ?? "",
          side,
          ordinal: 1,
          dark,
          textColor,
          origin,
          channel,
          autoplay,
          sequence,
        });

  return (
    <div className="w-full">
      {origin !== null && (
        <iframe
          ref={frameRef}
          title={side === "front" ? "Card front" : "Card back"}
          srcDoc={srcDoc}
          // Scripts run, but in an opaque origin: no cookies, storage or
          // access to the app. Popups let a card's links open in a new tab.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          // The frame is its own origin, so the browser only lets its audio
          // start by itself when the page says it may.
          allow="autoplay"
          className="block w-full border-0"
          // As tall as the card needs; the page scrolls, not the frame.
          style={{ height: Math.max(height, 64) }}
        />
      )}
    </div>
  );
}
