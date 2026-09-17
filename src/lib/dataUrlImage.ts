import { blobKeyFromUrl } from "./blobStorage";

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
// A chat attachment (ChatContent.tsx) — same order of magnitude as a note
// image, for the same reason (PNG-capable, pasted/dropped by the user).
export const MAX_CHAT_IMAGE_LENGTH = 4_000_000;

// A stored image field is now either the original inline data URL (existing
// rows, or the /api/blobs fallback when no blob store is configured — see
// src/app/api/blobs/route.ts) or a real URL a blob store handed back
// (/api/blobs/... locally, or the Storage bucket's own public URL on
// Supabase). Real size/mimetype enforcement for uploads happens against the
// actual file in /api/blobs's POST handler — but that enforcement only
// means anything if these fields are restricted to URLs that handler (or
// its Supabase-mode equivalent) actually produced. blobKeyFromUrl is the
// same recognizer blobStorage's own cleanup uses to tell "one of this app's
// blobs" from anything else, so an arbitrary external http(s):// URL
// (which would bypass that enforcement entirely, and — for the note/course
// image fields not this file's problem to solve, but worth noting — embeds
// a third-party URL that gets fetched by every viewer's browser) is
// rejected here rather than accepted as a legitimate stored image.
const MAX_IMAGE_URL_LENGTH = 2000;

function isImageUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_IMAGE_URL_LENGTH && blobKeyFromUrl(value) !== null;
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

export function isValidChatImageAttachment(value: unknown): value is string {
  return isDataUrlImage(value, MAX_CHAT_IMAGE_LENGTH) || isImageUrl(value);
}
