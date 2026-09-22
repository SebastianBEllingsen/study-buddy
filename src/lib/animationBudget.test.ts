import { describe, it, expect } from "vitest";
import {
  initialEncodeSettings,
  MAX_ATTEMPTS,
  MAX_FRAME_STEP,
  MIN_QUALITY,
  MIN_SCALE,
  nextEncodeSettings,
  selectFrames,
  type EncodeSettings,
} from "./animationBudget";

// A plausible size model — area × frames, with quality mattering somewhat —
// to check the planner converges the way it's meant to. Real encoders are
// noisier than this, which is what the headroom in the planner is for.
function modelSize(base: number, s: EncodeSettings, hasQualityKnob: boolean): number {
  const qualityFactor = hasQualityKnob ? 0.4 + 0.6 * s.quality : 1;
  return (base * s.scale ** 2 * qualityFactor) / s.frameStep;
}

function run(base: number, maxBytes: number, hasQualityKnob: boolean) {
  let settings = initialEncodeSettings(false);
  const tried = [settings];
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
    const size = modelSize(base, settings, hasQualityKnob);
    if (size <= maxBytes) return { fits: true, settings, tried };
    const next = nextEncodeSettings(settings, size, maxBytes, { hasQualityKnob });
    if (!next) return { fits: false, settings, tried };
    settings = next;
    tried.push(settings);
  }
  return { fits: modelSize(base, settings, hasQualityKnob) <= maxBytes, settings, tried };
}

describe("nextEncodeSettings", () => {
  it("has nothing to do when the attempt already fits", () => {
    expect(nextEncodeSettings(initialEncodeSettings(false), 5, 10, { hasQualityKnob: true })).toBeNull();
  });

  it("fits a moderately oversized animation quickly, without dropping frames", () => {
    const { fits, settings, tried } = run(20_000_000, 8_000_000, true);
    expect(fits).toBe(true);
    expect(settings.frameStep).toBe(1);
    expect(tried.length).toBeLessThanOrEqual(3);
  });

  it("gives up quality before resolution, and resolution before frames", () => {
    const first = nextEncodeSettings(initialEncodeSettings(false), 9_000_000, 8_000_000, { hasQualityKnob: true })!;
    expect(first.quality).toBeLessThan(initialEncodeSettings(false).quality);
    expect(first.frameStep).toBe(1);
    const scaled = nextEncodeSettings(initialEncodeSettings(false), 40_000_000, 8_000_000, { hasQualityKnob: true })!;
    expect(scaled.scale).toBeLessThan(1);
    expect(scaled.frameStep).toBe(1);
  });

  it("only drops frames once resolution is at its floor", () => {
    const atFloor = { scale: MIN_SCALE, quality: MIN_QUALITY, frameStep: 1 };
    expect(nextEncodeSettings(atFloor, 30_000_000, 8_000_000, { hasQualityKnob: true })).toEqual({
      ...atFloor,
      frameStep: 2,
    });
  });

  it("shrinks a GIF by resolution alone, since GIF has no quality setting", () => {
    const next = nextEncodeSettings(initialEncodeSettings(false), 16_000_000, 8_000_000, { hasQualityKnob: false })!;
    expect(next.quality).toBe(initialEncodeSettings(false).quality);
    expect(next.scale).toBeLessThan(1);
  });

  it("always makes progress on a near miss", () => {
    const next = nextEncodeSettings(initialEncodeSettings(false), 8_000_001, 8_000_000, { hasQualityKnob: false })!;
    expect(next.scale).toBeLessThanOrEqual(0.9);
  });

  it("gives up once every setting is exhausted", () => {
    const exhausted = { scale: MIN_SCALE, quality: MIN_QUALITY, frameStep: MAX_FRAME_STEP };
    expect(nextEncodeSettings(exhausted, 100_000_000, 8_000_000, { hasQualityKnob: true })).toBeNull();
    expect(run(10_000_000_000, 8_000_000, true).fits).toBe(false);
  });
});

describe("selectFrames", () => {
  it("keeps every frame at step 1", () => {
    expect(selectFrames([100, 50, 70], 1)).toEqual([
      { index: 0, durationMs: 100 },
      { index: 1, durationMs: 50 },
      { index: 2, durationMs: 70 },
    ]);
  });

  it("folds skipped frames' time into the kept ones, keeping total length", () => {
    const kept = selectFrames([100, 50, 70, 30, 40], 2);
    expect(kept).toEqual([
      { index: 0, durationMs: 150 },
      { index: 2, durationMs: 100 },
      { index: 4, durationMs: 40 },
    ]);
    expect(kept.reduce((s, f) => s + f.durationMs, 0)).toBe(290);
  });
});
