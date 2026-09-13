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

export function isValidCoverImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/") && value.length <= MAX_COVER_IMAGE_LENGTH;
}

export function isValidIconImage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/") && value.length <= MAX_ICON_IMAGE_LENGTH;
}

export function isValidPageBackgroundImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("data:image/") &&
    value.length <= MAX_PAGE_BACKGROUND_IMAGE_LENGTH
  );
}
