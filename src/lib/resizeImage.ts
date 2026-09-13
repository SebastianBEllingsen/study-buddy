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
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}
