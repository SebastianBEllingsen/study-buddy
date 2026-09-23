import { YOUTUBE_IFRAME_ALLOW, YOUTUBE_IFRAME_REFERRER_POLICY } from "@/lib/youtube";

// A YouTube player — see youTubeEmbedUrl for the URLs that produce one.
// `fill` stretches it to its container (a canvas card) instead of the
// default full-width 16:9 box used inside notes.
export default function YouTubeEmbed({ src, title, fill }: { src: string; title?: string; fill?: boolean }) {
  return (
    <iframe
      src={src}
      title={title || "YouTube video"}
      allow={YOUTUBE_IFRAME_ALLOW}
      referrerPolicy={YOUTUBE_IFRAME_REFERRER_POLICY}
      allowFullScreen
      className={fill ? "block size-full border-0" : "my-2 block aspect-video w-full rounded-lg border"}
    />
  );
}
