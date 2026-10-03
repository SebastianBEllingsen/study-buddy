// Drawing the Bloch sphere: a fixed 3D view, flattened to screen coordinates.
// The z axis points up; the view is turned `AZIMUTH` about it and tipped
// `ELEVATION` toward the viewer, so the equator reads as an ellipse.

export const AZIMUTH = 0.6;
export const ELEVATION = 0.35;

// A point on or inside the unit sphere as (right, up) on screen, both within
// [-1, 1].
export function project(x: number, y: number, z: number, azimuth = AZIMUTH, elevation = ELEVATION): { right: number; up: number } {
  const x1 = x * Math.cos(azimuth) - y * Math.sin(azimuth);
  const y1 = x * Math.sin(azimuth) + y * Math.cos(azimuth);
  return { right: x1, up: z * Math.cos(elevation) - y1 * Math.sin(elevation) };
}

// A great circle of the sphere, as screen points: "xy" is the equator.
export function greatCircle(plane: "xy" | "xz" | "yz", steps = 64): { right: number; up: number }[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / steps;
    const [a, b] = [Math.cos(t), Math.sin(t)];
    return plane === "xy" ? project(a, b, 0) : plane === "xz" ? project(a, 0, b) : project(0, a, b);
  });
}
