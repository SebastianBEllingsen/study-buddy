// Pictures with see-through areas — "stickers" — for backdrops and cover
// banners. Cropping keeps transparency only when the result actually has
// some (see ImageCropDialog's outputFormat="auto"), so ordinary photos stay
// compact JPEGs; pages then style a PNG backdrop as a sticker (see
// isStickerImageUrl).

// Any pixel less than fully opaque, in canvas RGBA order.
export function hasTransparentPixels(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) return true;
  }
  return false;
}

// Whether a picked file's format can carry transparency at all — decides
// whether the crop preview shows the see-through checkerboard.
export function mayHaveTransparency(mimeType: string): boolean {
  return /^image\/(png|webp|gif|avif)$/i.test(mimeType);
}

// A backdrop to style as a sticker (no dark tint, theme-colored title text).
// PNG only: a static crop with transparency is always saved as PNG, while
// GIF/WebP are also what animated uploads — usually opaque video-like
// clips — are saved as, so their extension says nothing about transparency.
export function isStickerImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return url.startsWith("data:image/png");
  return /\.png$/i.test(url.split(/[?#]/)[0]);
}
