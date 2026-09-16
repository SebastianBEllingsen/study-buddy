// Shared by every route that accepts a client-cropped/uploaded image as a
// data URL (paste-text image extraction, screenshot-crop-to-ask) — parses
// and size-caps it before it's handed to an AI vision call.
const MAX_IMAGE_LENGTH = 8_000_000;

export function parseDataUrlImage(
  value: unknown
): { base64: string; mimeType: string } | null {
  if (typeof value !== "string" || value.length > MAX_IMAGE_LENGTH) return null;
  const match = value.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

// Caps for images stored inline in a DB row rather than handed to an AI
// call — courses.cover_image/icon_image (CustomizeCourseDialog) and the
// uploaded_images library both crop client-side to one of these two shapes
// (see ImageCropDialog's ICON_*/COVER_* constants) before ever reaching the
// server, so these are a backstop against a request built some other way,
// not the normal path. The icon gets a looser cap than its small size
// implies because a badge needing a transparent background is exported as
// lossless PNG, which runs noticeably larger than an opaque JPEG the same
// size.
export const MAX_COVER_IMAGE_LENGTH = 2_000_000;
export const MAX_ICON_IMAGE_LENGTH = 1_500_000;
// A full-bleed page backdrop (Steam-library-style) covers far more pixels
// than the small cover banner, so it gets its own, looser cap.
export const MAX_PAGE_BACKGROUND_IMAGE_LENGTH = 4_000_000;
// An image pasted/dropped into a note (NoteEditor.tsx) — PNG-capable (see
// resizeImageForNote), so this needs more headroom than the always-JPEG
// cover/icon caps for the same pixel count.
export const MAX_NOTE_IMAGE_LENGTH = 4_000_000;

// A stored image field is now either the original inline data URL (existing
// rows, or the /api/blobs fallback when no blob store is configured — see
// src/app/api/blobs/route.ts) or a real URL a blob store handed back
// (/api/blobs/... locally, or the Storage bucket's own public URL on
// Supabase). Real size/mimetype enforcement for uploads now happens against
// the actual file in /api/blobs's POST handler — this length cap is just a
// backstop against a URL-shaped request built some other way.
const MAX_IMAGE_URL_LENGTH = 2000;

function isImageUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_IMAGE_URL_LENGTH &&
    (value.startsWith("/api/blobs/") || value.startsWith("http://") || value.startsWith("https://"))
  );
}

function isDataUrlImage(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.startsWith("data:image/") && value.length <= maxLength;
}

export function isValidCoverImage(value: unknown): value is string {
  return isDataUrlImage(value, MAX_COVER_IMAGE_LENGTH) || isImageUrl(value);
}

export function isValidIconImage(value: unknown): value is string {
  return isDataUrlImage(value, MAX_ICON_IMAGE_LENGTH) || isImageUrl(value);
}

export function isValidPageBackgroundImage(value: unknown): value is string {
  return isDataUrlImage(value, MAX_PAGE_BACKGROUND_IMAGE_LENGTH) || isImageUrl(value);
}

export function isValidNoteImage(value: unknown): value is string {
  return isDataUrlImage(value, MAX_NOTE_IMAGE_LENGTH) || isImageUrl(value);
}
