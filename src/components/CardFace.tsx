"use client";

import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import type { CardMedia } from "@/lib/types";
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
  const safe = media.filter((m) => isSafeCardMediaSrc(m.src, m.type));
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
          <MediaClip key={`${m.src}-${i}`} media={m} active={active} />
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

function MediaClip({ media, active }: { media: CardMedia; active: boolean }) {
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
        src={media.src}
        controls
        autoPlay={active}
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
        className="max-h-[45vh] min-h-0 w-full flex-1 rounded-md bg-black/5 object-contain"
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
