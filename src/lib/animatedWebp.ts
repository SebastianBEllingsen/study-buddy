// Assembles an animated WebP from single-frame WebP files. Browsers can
// encode one WebP frame (canvas.toBlob("image/webp")) but have no API for an
// animated one, so lib/animationEncoder.ts encodes each frame that way and
// this stitches them into the animated container — no codec work here, just
// the RIFF layout from the WebP container spec
// (https://developers.google.com/speed/webp/docs/riff_container):
//
//   RIFF <size> WEBP
//     VP8X  canvas size + "has animation" (and "has alpha") flags
//     ANIM  background color + loop count
//     ANMF  per frame: offset, size, duration, flags, then that frame's own
//           image chunks (ALPH + VP8, or VP8L) lifted out of its file
//
// Why WebP over GIF: lossy WebP frames are typically several times smaller
// than the same animation as a 256-color GIF, and keep full color and
// smooth alpha — which is what lets a cropped animation fit the upload cap
// without shrinking it much, or at all.

export interface WebpFrame {
  // A complete single-frame .webp file, as canvas.toBlob produced it.
  webp: Uint8Array;
  width: number;
  height: number;
  durationMs: number;
}

interface Chunk {
  fourcc: string;
  payload: Uint8Array;
}

function fourccAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function readWebpChunks(file: Uint8Array): Chunk[] {
  if (file.length < 12 || fourccAt(file, 0) !== "RIFF" || fourccAt(file, 8) !== "WEBP") {
    throw new Error("Not a WebP file");
  }
  const chunks: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= file.length) {
    const fourcc = fourccAt(file, pos);
    const size = u32le(file, pos + 4);
    const start = pos + 8;
    if (start + size > file.length) throw new Error("Truncated WebP chunk");
    chunks.push({ fourcc, payload: file.subarray(start, start + size) });
    pos = start + size + (size & 1); // chunks are padded to an even length
  }
  return chunks;
}

// The chunks that make up one frame's picture — everything else in a
// single-frame file (its own VP8X header, ICC/EXIF/XMP metadata) belongs to
// the file, not the frame, and has no place inside an ANMF.
const FRAME_IMAGE_CHUNKS = new Set(["ALPH", "VP8 ", "VP8L"]);

class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;

  bytes(data: Uint8Array | number[]) {
    const arr = data instanceof Uint8Array ? data : Uint8Array.from(data);
    this.parts.push(arr);
    this.length += arr.length;
  }
  ascii(text: string) {
    this.bytes(Array.from(text, (c) => c.charCodeAt(0)));
  }
  u16(n: number) {
    this.bytes([n & 255, (n >>> 8) & 255]);
  }
  u24(n: number) {
    this.bytes([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);
  }
  u32(n: number) {
    this.bytes([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }
  chunk(fourcc: string, payload: Uint8Array) {
    this.ascii(fourcc);
    this.u32(payload.length);
    this.bytes(payload);
    if (payload.length & 1) this.bytes([0]);
  }
  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

// WebP stores frame durations as 24-bit milliseconds.
const MAX_FRAME_DURATION = 0xffffff;

export function muxAnimatedWebp(frames: WebpFrame[], { loopCount = 0 }: { loopCount?: number } = {}): Uint8Array {
  if (frames.length === 0) throw new Error("No frames");
  const canvasWidth = Math.max(...frames.map((f) => f.width));
  const canvasHeight = Math.max(...frames.map((f) => f.height));

  let hasAlpha = false;
  const frameChunks = frames.map((frame) => {
    const image = readWebpChunks(frame.webp).filter((c) => FRAME_IMAGE_CHUNKS.has(c.fourcc));
    if (!image.some((c) => c.fourcc === "VP8 " || c.fourcc === "VP8L")) throw new Error("Frame has no image data");
    // VP8L can carry alpha without an ALPH chunk; flagging alpha when it
    // might not be used only costs the decoder a little, never correctness.
    if (image.some((c) => c.fourcc === "ALPH" || c.fourcc === "VP8L")) hasAlpha = true;
    return image;
  });

  const body = new ByteWriter();

  const vp8x = new ByteWriter();
  vp8x.bytes([(hasAlpha ? 0x10 : 0) | 0x02, 0, 0, 0]); // flags (alpha, animation) + 3 reserved bytes
  vp8x.u24(canvasWidth - 1);
  vp8x.u24(canvasHeight - 1);
  body.chunk("VP8X", vp8x.toUint8Array());

  const anim = new ByteWriter();
  anim.bytes([0, 0, 0, 0]); // background color (BGRA) — transparent
  anim.u16(Math.max(0, Math.min(0xffff, Math.round(loopCount)))); // 0 = loop forever
  body.chunk("ANIM", anim.toUint8Array());

  frames.forEach((frame, i) => {
    const anmf = new ByteWriter();
    anmf.u24(0); // X offset / 2 — every frame is a full canvas-sized frame
    anmf.u24(0); // Y offset / 2
    anmf.u24(frame.width - 1);
    anmf.u24(frame.height - 1);
    anmf.u24(Math.max(0, Math.min(MAX_FRAME_DURATION, Math.round(frame.durationMs))));
    // "Do not blend" + "do not dispose": each frame is already the fully
    // composited picture, so it simply replaces the previous one.
    anmf.bytes([0x02]);
    for (const chunk of frameChunks[i]) {
      const inner = new ByteWriter();
      inner.chunk(chunk.fourcc, chunk.payload);
      anmf.bytes(inner.toUint8Array());
    }
    body.chunk("ANMF", anmf.toUint8Array());
  });

  const file = new ByteWriter();
  file.ascii("RIFF");
  file.u32(4 + body.length);
  file.ascii("WEBP");
  file.bytes(body.toUint8Array());
  return file.toUint8Array();
}
