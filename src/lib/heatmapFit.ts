// Sizes the study heatmap to its widget: square size from the height the 7
// day-rows have to fill, number of week-columns from how many of those fit
// across — so a bigger tile shows a bigger, longer heatmap instead of a
// small fixed grid in one corner.

export interface HeatmapFit {
  cell: number;
  weeks: number;
}

export const HEATMAP_GAP = 3;
const MIN_CELL = 8;
const MAX_CELL = 26;
const MIN_WEEKS = 4;
// The dashboard's activity query covers one year (see listStudyActivity).
export const MAX_HEATMAP_WEEKS = 52;

export function fitHeatmap(width: number, height: number, gap = HEATMAP_GAP): HeatmapFit {
  const byHeight = Math.floor((height - gap * 6) / 7);
  let cell = Math.max(MIN_CELL, Math.min(MAX_CELL, byHeight));
  // A narrow, tall tile would otherwise show only a couple of huge columns:
  // shrink the squares until at least MIN_WEEKS fit across.
  const byMinWeeks = Math.floor((width + gap) / MIN_WEEKS - gap);
  if (byMinWeeks >= MIN_CELL) cell = Math.min(cell, byMinWeeks);
  const weeks = Math.max(1, Math.min(MAX_HEATMAP_WEEKS, Math.floor((width + gap) / (cell + gap))));
  return { cell, weeks };
}
