import { describe, expect, it } from "vitest";
import { HEATMAP_GAP, MAX_HEATMAP_WEEKS, fitHeatmap } from "./heatmapFit";

const gridWidth = ({ cell, weeks }: { cell: number; weeks: number }) => weeks * cell + (weeks - 1) * HEATMAP_GAP;
const gridHeight = ({ cell }: { cell: number }) => 7 * cell + 6 * HEATMAP_GAP;

describe("fitHeatmap", () => {
  it("fills the tile's height and as much of its width as whole weeks allow", () => {
    const fit = fitHeatmap(600, 120);
    expect(gridHeight(fit)).toBeLessThanOrEqual(120);
    expect(gridHeight({ cell: fit.cell + 1 })).toBeGreaterThan(120);
    expect(gridWidth(fit)).toBeLessThanOrEqual(600);
    expect(gridWidth({ ...fit, weeks: fit.weeks + 1 })).toBeGreaterThan(600);
  });

  it("uses bigger squares in a taller tile", () => {
    expect(fitHeatmap(900, 220).cell).toBeGreaterThan(fitHeatmap(900, 100).cell);
  });

  it("keeps squares within a sensible size range", () => {
    expect(fitHeatmap(900, 40).cell).toBe(8);
    expect(fitHeatmap(2000, 2000).cell).toBe(26);
  });

  it("never shows more weeks than there's data for", () => {
    expect(fitHeatmap(5000, 90).weeks).toBe(MAX_HEATMAP_WEEKS);
  });

  it("shrinks squares in a narrow, tall tile so several weeks still fit", () => {
    const fit = fitHeatmap(100, 400);
    expect(fit.weeks).toBeGreaterThanOrEqual(4);
    expect(gridWidth(fit)).toBeLessThanOrEqual(100);
  });
});
