// The roadmap line at the top of a plan — e.g. "1 → 2 + 3 → 4" — derived
// from each chapter's stage (chapters sharing a stage can be studied in
// parallel) and position. Never stored: editing a chapter's stage or
// reordering just changes what this computes.

export interface StagedChapter {
  id: number;
  position: number;
  stage: number;
}

// Chapters grouped by stage, stages in ascending order, chapters within a
// stage by position. Stage numbers needn't be contiguous (1, 3, 7 is fine).
export function groupStages<T extends StagedChapter>(chapters: T[]): T[][] {
  const byStage = new Map<number, T[]>();
  for (const chapter of chapters) {
    const stage = Number.isFinite(chapter.stage) ? chapter.stage : 0;
    byStage.set(stage, [...(byStage.get(stage) ?? []), chapter]);
  }
  return [...byStage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, group]) => group.sort((a, b) => a.position - b.position));
}

// Chapter numbers are 1-based by overall position, the same numbers the
// plan page shows next to each chapter title.
export function roadmapLabel(chapters: StagedChapter[]): string {
  const numberOf = new Map(
    [...chapters].sort((a, b) => a.position - b.position).map((c, i) => [c.id, i + 1])
  );
  return groupStages(chapters)
    .map((group) => group.map((c) => numberOf.get(c.id)).join(" + "))
    .join(" → ");
}

// Normalizes AI-proposed stages so they respect prerequisites: a chapter
// always sits in a later stage than every chapter it depends on. Indexes
// are 0-based positions into `chapters`; prerequisites pointing at itself,
// out of range, or forming a cycle are ignored rather than trusted.
export function resolveStages(chapters: { stage: number; prerequisites: number[] }[]): number[] {
  const stages = chapters.map((c) => (Number.isInteger(c.stage) && c.stage > 0 ? c.stage : 1));
  // Only earlier chapters can be prerequisites — that rules out cycles and
  // makes one forward pass enough.
  for (let i = 0; i < chapters.length; i++) {
    for (const p of chapters[i].prerequisites) {
      if (Number.isInteger(p) && p >= 0 && p < i) {
        stages[i] = Math.max(stages[i], stages[p] + 1);
      }
    }
  }
  // Renumber to 1..n so gaps from the adjustment above don't show.
  const distinct = [...new Set(stages)].sort((a, b) => a - b);
  return stages.map((s) => distinct.indexOf(s) + 1);
}
