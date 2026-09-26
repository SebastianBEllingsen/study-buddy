import { conceptKey } from "../conceptName";
import { listConceptsForCourse } from "./concepts";
import { ensureFsrsMigrated } from "./legacyMigration";
import { listMistakes } from "./mistakes";
import { loadQueueSources } from "./queue";
import { summarizeKnowledge, type KnowledgeSummary } from "./knowledgeSummary";

export async function loadCourseKnowledge(courseId: number, now = new Date()): Promise<KnowledgeSummary> {
  await ensureFsrsMigrated();
  const [sources, concepts, mistakes] = await Promise.all([
    loadQueueSources(courseId),
    listConceptsForCourse(courseId),
    listMistakes({ courseId, status: "open" }),
  ]);
  const chapterByConcept = new Map(concepts.map((c) => [conceptKey(c.name), c.chapter_id]));
  const openMistakesByConcept = new Map<string, number>();
  for (const m of mistakes) {
    if (!m.concept_name) continue;
    const key = conceptKey(m.concept_name);
    openMistakesByConcept.set(key, (openMistakesByConcept.get(key) ?? 0) + 1);
  }
  return summarizeKnowledge(sources, { now, chapterByConcept, openMistakesByConcept });
}
