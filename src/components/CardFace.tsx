"use client";

import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import useSWR from "swr";
import type { CardMedia } from "@/lib/types";
import type { AppSettings } from "@/lib/models";
import { isSafeCardMediaSrc } from "@/lib/cardMedia";
import { MathText } from "@/components/MathText";

// One side of a flashcard: its media (imported decks only — e.g. a sign
// language video) above its text. `active` is whether this face is the one
// showing; a face that's turned away pauses its video rather than playing
// it unseen behind the other side.
export function CardFace({
  text,
  media = [],
  active,
}: {
  text: string;
  media?: CardMedia[];
  active: boolean;
}) {
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const audioEls = useRef(new Map<number, HTMLAudioElement>());
  // The clip the automatic run expects to play next — null once the run is
  // over or you've pressed play on a clip yourself.
  const autoRunClip = useRef<number | null>(null);
  const safe = media.filter((m) => isSafeCardMediaSrc(m.src, m.type));
  // Only the first audio clip autoplays — decks often pair a word with an
  // example sentence, and both starting at once talk over each other. With
  // the "One after another" setting, that automatic run carries on through
  // the rest in turn; a clip you play yourself just plays on its own.
  const audioOrder = safe.flatMap((m, i) => (m.type === "audio" ? [i] : []));
  const sequence = settings?.flashcardAudioAutoplay === "sequence";
  const audioKey = audioOrder.map((i) => safe[i].src).join("\n");

  useEffect(() => {
    autoRunClip.current = active && audioKey ? 0 : null;
  }, [active, audioKey]);

  function handleAudioPlay(clip: number) {
    const expected = autoRunClip.current === null ? undefined : audioOrder[autoRunClip.current];
    if (clip !== expected) autoRunClip.current = null;
  }

  function handleAudioEnded(clip: number) {
    const position = autoRunClip.current;
    if (position === null || audioOrder[position] !== clip) return;
    const next = audioOrder[position + 1];
    if (!active || !sequence || next === undefined) {
      autoRunClip.current = null;
      return;
    }
    autoRunClip.current = position + 1;
    audioEls.current.get(next)?.play().catch(() => {});
  }
  if (safe.length === 0) {
    return (
      <div className="max-h-56 overflow-y-auto whitespace-pre-line">
        <MathText text={text} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3">
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2">
        {safe.map((m, i) => (
          <MediaClip
            key={`${m.src}-${i}`}
            media={m}
            active={active}
            autoPlayAudio={i === audioOrder[0]}
            audioRef={(el) => {
              if (el) audioEls.current.set(i, el);
              else audioEls.current.delete(i);
            }}
            onAudioPlay={() => handleAudioPlay(i)}
            onAudioEnded={() => handleAudioEnded(i)}
          />
        ))}
      </div>
      {text && (
        <div className="max-h-40 w-full shrink-0 overflow-y-auto whitespace-pre-line">
          <MathText text={text} />
        </div>
      )}
    </div>
  );
}

const SLOW_RATE = 0.5;

function MediaClip({
  media,
  active,
  autoPlayAudio,
  audioRef,
  onAudioPlay,
  onAudioEnded,
}: {
  media: CardMedia;
  active: boolean;
  autoPlayAudio: boolean;
  audioRef: (el: HTMLAudioElement | null) => void;
  onAudioPlay: () => void;
  onAudioEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      video.currentTime = 0;
      // Muted autoplay is always allowed; a rejected play() (e.g. the tab
      // is in the background) just leaves the first frame showing.
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [active, media.src]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = slow ? SLOW_RATE : 1;
  }, [slow]);

  if (media.type === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote/blob URLs from an imported deck
    return <img src={media.src} alt="" className="max-h-full min-h-0 max-w-full rounded-md object-contain" />;
  }
  if (media.type === "audio") {
    return (
      // Controls are the only way to replay audio, so clicks on them must
      // not also flip the card.
      <audio
        ref={audioRef}
        src={media.src}
        controls
        autoPlay={active && autoPlayAudio}
        onPlay={onAudioPlay}
        onEnded={onAudioEnded}
        className="w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5">
      {/* No native controls: clicking the video flips the card like the
          rest of it does, and looping replaces the replay button. */}
      <video
        ref={videoRef}
        src={media.src}
        muted
        loop
        playsInline
        preload="auto"
        className="max-h-[45vh] min-h-0 w-full flex-1 rounded-md bg-muted object-contain"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSlow((s) => !s);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        aria-pressed={slow}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground"
      >
        <Gauge className="size-3.5" />
        {slow ? "½× speed" : "1× speed"}
      </button>
    </div>
  );
}
