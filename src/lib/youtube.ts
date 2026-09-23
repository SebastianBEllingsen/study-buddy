// Turns a YouTube watch/share URL into its embeddable player URL, so a note
// can embed a video with Obsidian's own syntax — ![](https://youtu.be/...) —
// and a canvas link card pointing at a video can play it inline. Returns
// null for anything that isn't a recognizable YouTube video URL.

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// "90", "90s", "1m30s", "1h2m3s" — the forms YouTube's t=/start= accept.
export function parseYouTubeTimestamp(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m) return null;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

export function youTubeEmbedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www|m|music)\./, "");

  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "embed" || first === "shorts" || first === "live" || first === "v") id = second ?? null;
  }
  if (!id || !VIDEO_ID_RE.test(id)) return null;

  const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  const start = parseYouTubeTimestamp(url.searchParams.get("t") ?? url.searchParams.get("start"));
  if (start) embed.searchParams.set("start", String(start));
  return embed.toString();
}

// Shared by every place that renders the player (React and CodeMirror).
// The referrer policy is spelled out because YouTube refuses to play in an
// embed that sends no Referer at all ("error 153").
export const YOUTUBE_IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
export const YOUTUBE_IFRAME_REFERRER_POLICY = "strict-origin-when-cross-origin";
