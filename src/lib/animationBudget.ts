// Decides how to re-encode an animation that came out over its upload cap
// (see lib/animationEncoder.ts). Each retry is aimed using the size the
// previous attempt actually produced, rather than a fixed ladder of
// guesses, so it usually lands within a couple of passes: file size scales
// roughly with pixel area × frame count, and drops somewhat with quality.
//
// In order of how much they cost the picture:
//   1. lower WebP quality (a GIF has no quality knob, so it skips this)
//   2. shrink the resolution
//   3. only once the resolution is at its floor, drop every other frame
//      (merging the skipped frames' time into the kept ones, so the
//      animation still runs at the same overall speed, just choppier)

export interface EncodeSettings {
  scale: number; // multiplier on the output size the crop asked for
  quality: number; // WebP quality, 0–1
  frameStep: number; // keep every Nth frame
}

export const MIN_SCALE = 0.3;
export const MIN_QUALITY = 0.5;
export const MAX_FRAME_STEP = 4;
export const MAX_ATTEMPTS = 6;
const QUALITY_STEP = 0.15;
// Rough share of size one quality step saves — deliberately conservative,
// so a retry tends to undershoot the cap rather than need another pass.
const QUALITY_STEP_SAVING = 0.8;
// Aim a bit under the cap: sizes don't scale perfectly predictably.
const HEADROOM = 0.9;

export function initialEncodeSettings(unlimited: boolean): EncodeSettings {
  return { scale: 1, quality: unlimited ? 0.92 : 0.82, frameStep: 1 };
}

// null means there's nothing left to give up — the caller should stop and
// report that the animation can't fit.
export function nextEncodeSettings(
  prev: EncodeSettings,
  producedBytes: number,
  maxBytes: number,
  { hasQualityKnob }: { hasQualityKnob: boolean }
): EncodeSettings | null {
  if (producedBytes <= maxBytes) return null;
  // How much smaller the next attempt needs to be, as a fraction.
  let remaining = (maxBytes / producedBytes) * HEADROOM;
  let { scale, quality, frameStep } = prev;

  if (hasQualityKnob && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, Math.round((quality - QUALITY_STEP) * 100) / 100);
    remaining /= QUALITY_STEP_SAVING;
  }

  if (remaining < 1 && scale > MIN_SCALE) {
    // Area shrinks with the square of the scale. Always shrink by at least
    // 10% so a near-miss still makes real progress.
    const next = Math.max(MIN_SCALE, Math.min(scale * 0.9, scale * Math.sqrt(remaining)));
    remaining /= (next / scale) ** 2;
    scale = Math.round(next * 1000) / 1000;
  }

  if (remaining < 1 && scale <= MIN_SCALE && frameStep < MAX_FRAME_STEP) {
    frameStep = Math.min(MAX_FRAME_STEP, frameStep * 2);
  }

  if (scale === prev.scale && quality === prev.quality && frameStep === prev.frameStep) return null;
  return { scale, quality, frameStep };
}

// Which frames to keep for a given frameStep, each carrying the combined
// duration of itself and the frames skipped after it.
export function selectFrames(durationsMs: number[], frameStep: number): { index: number; durationMs: number }[] {
  const kept: { index: number; durationMs: number }[] = [];
  for (let i = 0; i < durationsMs.length; i += frameStep) {
    const group = durationsMs.slice(i, i + frameStep);
    kept.push({ index: i, durationMs: group.reduce((sum, d) => sum + d, 0) });
  }
  return kept;
}
