"use client";

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { computeScaledDimensions } from "@/lib/resizeImage";
import { gifDelayMs, gifRepeat } from "@/lib/animatedImage";
import { muxAnimatedWebp, type WebpFrame } from "@/lib/animatedWebp";
import {
  initialEncodeSettings,
  MAX_ATTEMPTS,
  nextEncodeSettings,
  selectFrames,
  type EncodeSettings,
} from "@/lib/animationBudget";
import { formatMegabytes } from "@/lib/uploadLimits";
import { ImageUploadError } from "@/lib/uploadImage";

// Re-encodes an animated image (GIF, animated WebP, APNG) — cropped, for
// ImageCropDialog, or whole, for an oversized note/canvas image — so it
// still animates afterwards. A canvas only ever holds one frame, which is
// why the ordinary still-image paths can't do this.
//
// Frames come from WebCodecs' ImageDecoder (fully composited, so no GIF
// disposal/blending logic to reimplement) and are written as animated WebP
// (lib/animatedWebp.ts) — several times smaller than GIF with full color —
// or as GIF where the browser can't encode WebP (Safari). Given a byte
// budget, it retries at lower quality/resolution until the result fits
// (see lib/animationBudget.ts for how each retry is chosen).

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export type EncodeProgress = { fraction: number; attempt: number };

// Well past any reasonable animated backdrop or icon, but stops a
// thousand-frame video-as-GIF from locking up the tab for minutes.
export const MAX_ANIMATION_FRAMES = 500;

// An ImageUploadError, so upload call sites' existing describeUploadError
// shows this message rather than their generic fallback.
export class AnimationTooLargeError extends ImageUploadError {
  constructor(maxBytes: number) {
    super(`This animation is too large to fit ${formatMegabytes(maxBytes)}, even compressed`);
  }
}

export function canEncodeAnimations(): boolean {
  return typeof window !== "undefined" && typeof window.ImageDecoder !== "undefined";
}

let webpSupport: boolean | null = null;
// Chrome, Edge and Firefox encode WebP from a canvas; Safari silently hands
// back a PNG instead, which is how this tells the difference.
export function canEncodeWebp(): boolean {
  if (webpSupport === null) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupport;
}

// Never upscales past the source's own pixels in the cropped region: a
// still crop can afford to render at the fixed output size (one JPEG), but
// every extra pixel in an animation is paid for once per frame — a small
// animated sticker blown up to a 1600px-wide backdrop would multiply its
// file size many times over for no added detail.
export function animatedOutputSize(crop: CropRect, maxWidth: number, maxHeight: number, scale = 1) {
  const { width, height } = computeScaledDimensions(crop.sw, crop.sh, maxWidth, maxHeight);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas produced no image data"))), type, quality)
  );
}

// Lets the browser repaint (the progress label) between frames. Not
// setTimeout(0): a tab in the background has its timers throttled — after a
// few minutes hidden, to roughly one per minute — so an encode left running
// while you look at another tab would slow to a crawl, one frame a minute.
// A MessageChannel message is still dispatched promptly in a hidden tab.
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function encodeAnimation(
  file: File,
  {
    crop,
    maxWidth = Infinity,
    maxHeight = Infinity,
    maxBytes = Infinity,
    transparent = false,
    onProgress,
  }: {
    // The source region to keep — omitted for the whole image.
    crop?: CropRect;
    maxWidth?: number;
    maxHeight?: number;
    maxBytes?: number;
    // Only matters for the GIF fallback: keep see-through pixels
    // see-through (icons/badges) rather than flattening them to black. WebP
    // always keeps alpha.
    transparent?: boolean;
    onProgress?: (progress: EncodeProgress) => void;
  } = {}
): Promise<Blob> {
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new Error("No image track");
    const frameCount = Math.min(track.frameCount, MAX_ANIMATION_FRAMES);
    const repeat = gifRepeat(track.repetitionCount);
    const useWebp = canEncodeWebp();

    // Every frame's duration, filled in during the first attempt (which
    // always decodes every frame) and reused when a later attempt skips
    // frames and needs to fold their time into the kept ones.
    const durations: number[] = [];
    let region = crop;

    let settings: EncodeSettings = initialEncodeSettings(!Number.isFinite(maxBytes));
    for (let attempt = 1; ; attempt++) {
      const frames = attempt === 1 ? null : selectFrames(durations, settings.frameStep);
      const indices = frames ? frames.map((f) => f.index) : Array.from({ length: frameCount }, (_, i) => i);

      let canvas: HTMLCanvasElement | null = null;
      let ctx: CanvasRenderingContext2D | null = null;
      const webpFrames: WebpFrame[] = [];
      const gif = useWebp ? null : GIFEncoder();

      for (const [n, index] of indices.entries()) {
        const { image } = await decoder.decode({ frameIndex: index });
        if (attempt === 1) durations[index] = gifDelayMs(image.duration);
        region ??= { sx: 0, sy: 0, sw: image.displayWidth, sh: image.displayHeight };
        const { width, height } = animatedOutputSize(region, maxWidth, maxHeight, settings.scale);
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          ctx = canvas.getContext("2d", { willReadFrequently: !useWebp });
          if (!ctx) throw new Error("Canvas not supported");
        }
        ctx!.clearRect(0, 0, width, height);
        ctx!.drawImage(image, region.sx, region.sy, region.sw, region.sh, 0, 0, width, height);
        image.close();
        const durationMs = frames ? frames[n].durationMs : durations[index];

        if (useWebp) {
          const blob = await canvasToBlob(canvas, "image/webp", settings.quality);
          webpFrames.push({ webp: new Uint8Array(await blob.arrayBuffer()), width, height, durationMs });
        } else {
          const { data } = ctx!.getImageData(0, 0, width, height);
          const format = transparent ? "rgba4444" : "rgb565";
          const palette = quantize(data, 256, { format, oneBitAlpha: transparent });
          const indexed = applyPalette(data, palette, format);
          const transparentIndex = transparent ? palette.findIndex((color) => color[3] === 0) : -1;
          gif!.writeFrame(indexed, width, height, {
            palette,
            delay: durationMs,
            repeat,
            transparent: transparentIndex >= 0,
            transparentIndex: Math.max(0, transparentIndex),
          });
        }

        onProgress?.({ fraction: (n + 1) / indices.length, attempt });
        // Encoding is synchronous-heavy — yield so the progress label
        // repaints and the tab stays responsive on a long animation.
        await yieldToBrowser();
      }

      let bytes: Uint8Array;
      if (useWebp) {
        bytes = muxAnimatedWebp(webpFrames, { loopCount: repeat });
      } else {
        gif!.finish();
        bytes = gif!.bytes();
      }
      const result = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: useWebp ? "image/webp" : "image/gif" });
      if (result.size <= maxBytes) return result;

      const next = attempt < MAX_ATTEMPTS && nextEncodeSettings(settings, result.size, maxBytes, { hasQualityKnob: useWebp });
      if (!next) throw new AnimationTooLargeError(maxBytes);
      settings = next;
    }
  } finally {
    decoder.close();
  }
}
