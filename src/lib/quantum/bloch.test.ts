import { describe, expect, it } from "vitest";
import { greatCircle, project } from "./bloch";

describe("project", () => {
  it("draws the centre at the centre and the +z pole straight up", () => {
    expect(project(0, 0, 0)).toEqual({ right: 0, up: 0 });
    const pole = project(0, 0, 1);
    expect(pole.right).toBeCloseTo(0, 12);
    expect(pole.up).toBeGreaterThan(0.9);
    expect(project(0, 0, -1).up).toBeCloseTo(-pole.up, 12);
  });

  it("keeps everything inside the unit circle, and tells the x and y axes apart", () => {
    for (const [x, y, z] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0.8, 0], [0.3, -0.4, 0.5]]) {
      const p = project(x, y, z);
      expect(Math.hypot(p.right, p.up)).toBeLessThanOrEqual(1 + 1e-12);
    }
    const px = project(1, 0, 0), py = project(0, 1, 0);
    expect(px.right).toBeGreaterThan(0);
    expect(py.right).toBeLessThan(0);
  });

  it("looks straight on when the view isn't turned or tipped", () => {
    expect(project(1, 0, 0, 0, 0)).toEqual({ right: 1, up: 0 });
    expect(project(0, 0, 1, 0, 0)).toEqual({ right: 0, up: 1 });
    expect(project(0, 1, 0, 0, 0).right).toBeCloseTo(0, 12);
  });
});

describe("greatCircle", () => {
  it("closes on itself and stays on the sphere's outline or inside it", () => {
    for (const plane of ["xy", "xz", "yz"] as const) {
      const pts = greatCircle(plane);
      expect(pts[0].right).toBeCloseTo(pts[pts.length - 1].right, 12);
      expect(pts[0].up).toBeCloseTo(pts[pts.length - 1].up, 12);
      for (const p of pts) expect(Math.hypot(p.right, p.up)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});
