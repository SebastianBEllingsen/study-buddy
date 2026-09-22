import { describe, it, expect } from "vitest";
import { animatedOutputSize } from "./animationEncoder";

// encodeAnimation itself needs WebCodecs' ImageDecoder and a real
// canvas, neither of which jsdom has — this covers the sizing decision it
// makes, which is the part that determines file size.
describe("animatedOutputSize", () => {
  it("never upscales a small animation to the full output size", () => {
    expect(animatedOutputSize({ sx: 0, sy: 0, sw: 480, sh: 229 }, 1600, 762)).toEqual({ width: 480, height: 229 });
  });

  it("scales a large crop down to fit the output box", () => {
    expect(animatedOutputSize({ sx: 10, sy: 10, sw: 3200, sh: 1524 }, 1600, 762)).toEqual({ width: 1600, height: 762 });
  });

  it("never produces an empty frame", () => {
    expect(animatedOutputSize({ sx: 0, sy: 0, sw: 0.2, sh: 0.2 }, 240, 240)).toEqual({ width: 1, height: 1 });
  });
});

describe("animatedOutputSize with a retry scale", () => {
  it("shrinks the output by the given factor", () => {
    expect(animatedOutputSize({ sx: 0, sy: 0, sw: 800, sh: 400 }, 1600, 762, 0.5)).toEqual({ width: 400, height: 200 });
  });

  it("keeps the source's full size when there's no output cap", () => {
    expect(animatedOutputSize({ sx: 0, sy: 0, sw: 2400, sh: 1000 }, Infinity, Infinity)).toEqual({ width: 2400, height: 1000 });
  });
});
