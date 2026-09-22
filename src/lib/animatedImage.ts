// Detects whether an uploaded image is animated by reading its bytes — a
// canvas (which every resize/crop path in this app draws through) only ever
// holds one frame, so an animated upload has to be recognized up front and
// kept off that path. Pure and synchronous over the raw bytes, so it's
// unit-testable without a browser and works in every browser (unlike
// WebCodecs' ImageDecoder, which lib/animatedGif.ts only needs for the
// separate job of actually decoding frames).
//
// Covers the three animatable formats /api/blobs accepts (see
// blobStorage/imageTypes.ts): GIF, animated WebP, and APNG. JPEG can't
// animate.

export function isAnimatedImage(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case "image/gif":
      return gifFrameCount(bytes, 2) > 1;
    case "image/webp":
      return isAnimatedWebp(bytes);
    case "image/png":
      return isApng(bytes);
    default:
      return false;
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

// Walks the GIF block structure (header → logical screen descriptor →
// optional global color table → extension/image blocks → trailer) counting
// image descriptors, stopping once `stopAt` is reached. A GIF with more
// than one image is animated; the NETSCAPE2.0 loop extension alone isn't a
// reliable signal (some static GIFs carry it, some animated ones don't).
export function gifFrameCount(bytes: Uint8Array, stopAt = Infinity): number {
  const header = ascii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return 0;
  let pos = 13;
  const screenFlags = bytes[10] ?? 0;
  if (screenFlags & 0x80) pos += 3 * (1 << ((screenFlags & 0x07) + 1));

  // Data sub-blocks: a length byte then that many bytes, ending at a 0.
  const skipSubBlocks = () => {
    while (pos < bytes.length) {
      const size = bytes[pos];
      pos += 1;
      if (size === 0) return;
      pos += size;
    }
  };

  let frames = 0;
  while (pos < bytes.length && frames < stopAt) {
    const introducer = bytes[pos];
    if (introducer === 0x21) {
      pos += 2; // introducer + extension label
      skipSubBlocks();
    } else if (introducer === 0x2c) {
      frames += 1;
      const imageFlags = bytes[pos + 9] ?? 0;
      pos += 10;
      if (imageFlags & 0x80) pos += 3 * (1 << ((imageFlags & 0x07) + 1));
      pos += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      break; // 0x3B trailer, or bytes we don't understand
    }
  }
  return frames;
}

// An animated WebP is always the extended ("VP8X") format with the
// animation flag set in its header.
function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return false;
  if (ascii(bytes, 12, 4) !== "VP8X") return false;
  return ((bytes[20] ?? 0) & 0x02) !== 0;
}

// APNG is a normal PNG with an "acTL" (animation control) chunk before the
// first image data chunk, whose first field is the frame count.
function isApng(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== "PNG") return false;
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const length = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
    const type = ascii(bytes, pos + 4, 4);
    if (type === "acTL") {
      const d = pos + 8;
      const frameCount = ((bytes[d] << 24) | (bytes[d + 1] << 16) | (bytes[d + 2] << 8) | bytes[d + 3]) >>> 0;
      return frameCount > 1;
    }
    if (type === "IDAT" || type === "IEND") return false;
    pos += 12 + length; // length + type + data + CRC
  }
  return false;
}

// GIF stores per-frame delays in hundredths of a second, and browsers show
// anything under 20ms as 100ms (a legacy quirk every major engine shares).
// Converting a decoded frame's duration the same way keeps a re-encoded
// animation playing at the speed it did before cropping.
export function gifDelayMs(durationMicroseconds: number | null | undefined): number {
  const ms = (durationMicroseconds ?? 0) / 1000;
  if (!Number.isFinite(ms) || ms < 20) return 100;
  return Math.round(ms / 10) * 10;
}

// GIF's loop field counts *extra* plays, with 0 meaning forever — while
// ImageDecoder reports a track's repetitionCount as Infinity for forever.
export function gifRepeat(repetitionCount: number): number {
  return Number.isFinite(repetitionCount) ? Math.max(0, Math.round(repetitionCount)) : 0;
}
