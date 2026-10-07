import { resolveStages } from "../studyPlan/roadmap";
import type { NewChapter } from "../studyPlan/store";
import { PROGRAMMING_CURRICULUM, type Curriculum } from "./programming";

// Pure (no database): the built-in curricula and how a curriculum becomes
// study plan chapters. install.ts does the saving.

export const CURRICULA: Record<string, Curriculum> = { [PROGRAMMING_CURRICULUM.id]: PROGRAMMING_CURRICULUM };

export function isCurriculumId(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(CURRICULA, value);
}

// Prerequisite titles → indexes. A title that doesn't exist, or that isn't
// earlier in the list, is a mistake in the curriculum data: throw, so it's
// caught by the tests rather than silently dropping a dependency.
export function prerequisiteIndexes(curriculum: Curriculum): number[][] {
  const indexOf = new Map(curriculum.chapters.map((c, i) => [c.title, i]));
  return curriculum.chapters.map((c, i) =>
    c.prerequisites.map((title) => {
      const at = indexOf.get(title);
      if (at === undefined) throw new Error(`"${c.title}" needs unknown chapter "${title}"`);
      if (at >= i) throw new Error(`"${c.title}" needs "${title}", which doesn't come before it`);
      return at;
    })
  );
}

export function curriculumChapters(curriculum: Curriculum): NewChapter[] {
  const prerequisites = prerequisiteIndexes(curriculum);
  const stages = resolveStages(prerequisites.map((p) => ({ stage: 1, prerequisites: p })));
  return curriculum.chapters.map((c, i) => ({
    title: c.title,
    summary: `${c.part} — ${c.summary}`,
    subtopics: c.subtopics,
    prerequisites: prerequisites[i],
    stage: stages[i],
    linked_document_ids: [],
    estimated_minutes: c.estimatedMinutes,
    resources: c.resources.map((r) => ({
      ...r,
      language: "en",
      note: "",
      // Hand-picked, so a "regenerate resources" keeps them.
      origin: "user" as const,
      link_status: "unchecked" as const,
      status_detail: null,
      checked_at: null,
    })),
  }));
}
