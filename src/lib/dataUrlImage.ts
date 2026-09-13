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
