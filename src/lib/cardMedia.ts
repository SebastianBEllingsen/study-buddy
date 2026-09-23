import type { CardMedia, CardMediaType } from "@/lib/types";

const MEDIA_TYPES = new Set<CardMediaType>(["video", "image", "audio"]);

// What a flashcard's <video>/<img>/<audio> is allowed to point at: a plain
// http(s) URL, this app's own blob route, or an inline data: URL of the
// matching media kind. Anything else (javascript:, file:, relative paths
// that only meant something inside the original Anki package) is refused
// both when content is saved and again when it's rendered.
export function isSafeCardMediaSrc(src: string, type: CardMediaType): boolean {
  if (src.startsWith("/api/blobs/")) return !src.includes("..");
  if (src.startsWith("data:")) return src.startsWith(`data:${type}/`);
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isValidCardMediaList(value: unknown): value is CardMedia[] {
  return (
    Array.isArray(value) &&
    value.every((m) => {
      if (!m || typeof m !== "object") return false;
      const { type, src } = m as Record<string, unknown>;
      return (
        typeof type === "string" &&
        MEDIA_TYPES.has(type as CardMediaType) &&
        typeof src === "string" &&
        isSafeCardMediaSrc(src, type as CardMediaType)
      );
    })
  );
}
