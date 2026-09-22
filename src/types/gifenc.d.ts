// Minimal typings for gifenc (https://github.com/mattdesl/gifenc), which
// ships none — only the parts lib/animatedGif.ts uses.
declare module "gifenc" {
  export type GifPalette = number[][];
  export type GifColorFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface GifFrameOptions {
    palette?: GifPalette;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
  }

  export interface GifEncoderStream {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderStream;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: GifColorFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean }
  ): GifPalette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifColorFormat
  ): Uint8Array;
}
