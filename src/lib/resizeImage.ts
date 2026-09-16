// Aspect-ratio-preserving downscale, capped at 1x — never upscales a
// smaller-than-target source. Pulled out as its own pure function (see
// resizeImage.test.ts) since the two exports below are otherwise only
// testable against a real canvas/createImageBitmap, which jsdom doesn't
// implement and this app doesn't otherwise depend on a native canvas
// package for.
export function computeScaledDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return { width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale) };
}

// PNG only for formats that can actually carry alpha (png/gif/webp) — a
// source JPEG is already opaque, so re-encoding it as JPEG rather than a
// much larger lossless PNG loses nothing. See resizeImageForNote's own
// comment for why this matters there specifically.
export function preservesAlpha(mimeType: string): boolean {
  return ["image/png", "image/gif", "image/webp"].includes(mimeType);
}

// Client-only: downscales/compresses an uploaded image before it's sent to
// the server as a data URL — course cover images are stored inline in the
// courses table (see schema.pg.ts's cover_image column) rather than on
// disk, so keeping them small matters for both DB size and Postgres sync.
export async function resizeImageToDataUrl(
  file: File,
  maxWidth = 1600,
  maxHeight = 500,
  quality = 0.82
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = computeScaledDimensions(bitmap.width, bitmap.height, maxWidth, maxHeight);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

// For a note-embedded image (NoteEditor.tsx) — unlike resizeImageToDataUrl
// above, this preserves transparency: a screenshot or diagram pasted into a
// note is just as likely to have a transparent background as a photo is to
// need one flattened, so the format is picked from the source rather than
// hardcoded to JPEG. PNG only for formats that can actually carry alpha
// (png/gif/webp) — a source JPEG is already opaque, so re-encoding it as
// JPEG rather than a much larger lossless PNG loses nothing.
export async function resizeImageForNote(
  file: File,
  maxWidth = 1400,
  maxHeight = 1400,
  quality = 0.85
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = computeScaledDimensions(bitmap.width, bitmap.height, maxWidth, maxHeight);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const preserveAlpha = preservesAlpha(file.type);
  const blob = await new Promise<Blob | null>((resolve) =>
    preserveAlpha ? canvas.toBlob(resolve, "image/png") : canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) throw new Error("Canvas produced no image data");
  return blob;
}
