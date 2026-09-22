import { describe, it, expect } from "vitest";
import { muxAnimatedWebp, readWebpChunks } from "./animatedWebp";
import { isAnimatedImage } from "./animatedImage";

// Stand-ins for what canvas.toBlob("image/webp") produces: the chunk layout
// is real, the codec payloads are placeholder bytes (this module never
// decodes them — it only moves them). Real decoding of a muxed file is
// covered by running the app, since jsdom has no WebP codec.
function chunk(fourcc: string, payload: number[]): number[] {
  const size = payload.length;
  return [
    ...Array.from(fourcc, (c) => c.charCodeAt(0)),
    size & 255,
    (size >>> 8) & 255,
    (size >>> 16) & 255,
    (size >>> 24) & 255,
    ...payload,
    ...(size & 1 ? [0] : []),
  ];
}

function webpFile(...chunks: number[][]): Uint8Array {
  const body = chunks.flat();
  const size = 4 + body.length;
  return Uint8Array.from([
    ...Array.from("RIFF", (c) => c.charCodeAt(0)),
    size & 255,
    (size >>> 8) & 255,
    (size >>> 16) & 255,
    (size >>> 24) & 255,
    ...Array.from("WEBP", (c) => c.charCodeAt(0)),
    ...body,
  ]);
}

// A simple lossy frame (no alpha), and one with an ALPH chunk under a VP8X
// header plus metadata that must NOT be copied into the frame.
const opaqueFrame = webpFile(chunk("VP8 ", [1, 2, 3, 4, 5]));
const alphaFrame = webpFile(
  chunk("VP8X", [0x10, 0, 0, 0, 3, 0, 0, 1, 0, 0]),
  chunk("ALPH", [9, 9, 9]),
  chunk("VP8 ", [7, 7, 7, 7]),
  chunk("EXIF", [42, 42])
);

function u24(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

describe("muxAnimatedWebp", () => {
  const out = muxAnimatedWebp(
    [
      { webp: opaqueFrame, width: 4, height: 2, durationMs: 120 },
      { webp: alphaFrame, width: 4, height: 2, durationMs: 80 },
    ],
    { loopCount: 3 }
  );
  const chunks = readWebpChunks(out);

  it("produces a file the app's own sniffer recognizes as animated", () => {
    expect(isAnimatedImage(out, "image/webp")).toBe(true);
  });

  it("writes a consistent RIFF size", () => {
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(riffSize).toBe(out.length - 8);
  });

  it("lays out VP8X, ANIM, then one ANMF per frame", () => {
    expect(chunks.map((c) => c.fourcc)).toEqual(["VP8X", "ANIM", "ANMF", "ANMF"]);
    const [vp8x, anim] = chunks;
    expect(vp8x.payload[0]).toBe(0x12); // animation + alpha (frame 2 has ALPH)
    expect([u24(vp8x.payload, 4) + 1, u24(vp8x.payload, 7) + 1]).toEqual([4, 2]);
    expect(anim.payload[4] | (anim.payload[5] << 8)).toBe(3);
  });

  it("records each frame's size and duration and copies only its image chunks", () => {
    const [, , first, second] = chunks;
    expect([u24(first.payload, 6) + 1, u24(first.payload, 9) + 1, u24(first.payload, 12)]).toEqual([4, 2, 120]);
    expect(u24(second.payload, 12)).toBe(80);
    const innerFourccs = (anmf: { payload: Uint8Array }) => {
      // Re-wrap the ANMF body (after its 16-byte header) as a WebP file so
      // the same chunk reader can walk it.
      const inner = anmf.payload.subarray(16);
      const wrapped = new Uint8Array(12 + inner.length);
      wrapped.set(Array.from("RIFF\0\0\0\0WEBP", (c) => c.charCodeAt(0)));
      wrapped.set(inner, 12);
      return readWebpChunks(wrapped).map((c) => c.fourcc);
    };
    expect(innerFourccs(first)).toEqual(["VP8 "]);
    expect(innerFourccs(second)).toEqual(["ALPH", "VP8 "]);
  });

  it("leaves the alpha flag off when no frame has alpha", () => {
    const opaque = muxAnimatedWebp([
      { webp: opaqueFrame, width: 4, height: 2, durationMs: 100 },
      { webp: opaqueFrame, width: 4, height: 2, durationMs: 100 },
    ]);
    expect(readWebpChunks(opaque)[0].payload[0]).toBe(0x02);
  });

  it("rejects input that isn't a usable WebP frame", () => {
    expect(() => muxAnimatedWebp([])).toThrow();
    expect(() => muxAnimatedWebp([{ webp: new Uint8Array([1, 2, 3]), width: 1, height: 1, durationMs: 1 }])).toThrow();
    expect(() => muxAnimatedWebp([{ webp: webpFile(chunk("EXIF", [1])), width: 1, height: 1, durationMs: 1 }])).toThrow();
  });
});
