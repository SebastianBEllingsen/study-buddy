import { generateStructured } from "../aiClient";
import { createCanvas, getAppSettings, getCourse } from "../models";
import { sanitizeCanvasData } from "../canvas";
import { cleanConceptName, conceptKey } from "../conceptName";
import { languageName } from "../languages";
import { conceptMapSystemPrompt, conceptMapUserPrompt } from "../prompts/conceptMap";
import { getStudyPlanForCourse } from "../studyPlan/store";
import { listConceptsForCourse } from "../review/concepts";
import { loadCourseKnowledge } from "../review/knowledge";
import { layoutConceptMap, type MapGroup, type MapLink } from "./layout";

// Draws a course's concepts as a canvas: study plan chapters as groups with
// their subtopics, plus concepts from tagged cards and questions that the
// plan doesn't list; the AI supplies the links.

export class ConceptMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConceptMapError";
  }
}

const MAX_PER_GROUP = 10;
const MAX_OTHER = 15;
const MAX_LINKS = 60;

export async function collectMapGroups(courseId: number): Promise<MapGroup[]> {
  const [plan, concepts, knowledge] = await Promise.all([
    getStudyPlanForCourse(courseId),
    listConceptsForCourse(courseId),
    loadCourseKnowledge(courseId),
  ]);
  const recall = new Map(knowledge.concepts.map((c) => [conceptKey(c.name), c.reviewed > 0 ? c.recall : null]));
  let n = 0;
  const seen = new Set<string>();
  const concept = (raw: string) => {
    const name = cleanConceptName(raw);
    if (!name || seen.has(conceptKey(name))) return null;
    seen.add(conceptKey(name));
    return { id: `c${++n}`, name, recall: recall.get(conceptKey(name)) ?? null };
  };

  const groups: MapGroup[] = [];
  const chapters = [...(plan?.chapters ?? [])].sort((a, b) => a.stage - b.stage || a.position - b.position);
  for (const chapter of chapters) {
    const items = chapter.subtopics
      .map((s) => concept(s.text))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .slice(0, MAX_PER_GROUP);
    if (items.length) groups.push({ label: chapter.title, concepts: items });
  }
  const other = concepts
    .map((c) => concept(c.name))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .slice(0, MAX_OTHER);
  if (other.length) groups.push({ label: chapters.length ? "Other concepts" : "Concepts", concepts: other });
  return groups;
}

export function normalizeLinks(raw: unknown, ids: Set<string>): MapLink[] {
  const links = (raw as { links?: unknown })?.links;
  if (!Array.isArray(links)) return [];
  return links
    .flatMap((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      const from = typeof o.from === "string" ? o.from.trim() : "";
      const to = typeof o.to === "string" ? o.to.trim() : "";
      const label = typeof o.label === "string" ? o.label.trim().slice(0, 60) : "";
      return ids.has(from) && ids.has(to) && from !== to ? [{ from, to, label }] : [];
    })
    .slice(0, MAX_LINKS);
}

export async function buildConceptMap(courseId: number): Promise<{ canvasId: number }> {
  const groups = await collectMapGroups(courseId);
  const count = groups.reduce((n, g) => n + g.concepts.length, 0);
  if (count < 3) {
    throw new ConceptMapError("Not enough concepts yet — build a study plan or tag your cards and questions first.");
  }
  const [course, settings] = await Promise.all([getCourse(courseId), getAppSettings()]);
  const raw = await generateStructured<unknown>({
    system: conceptMapSystemPrompt(course?.name ?? "this course", languageName(settings.preferredLanguage)),
    user: conceptMapUserPrompt(groups),
    maxTokens: 4000,
    effort: settings.aiEfficiencyMode ? "low" : "medium",
    efficient: settings.aiEfficiencyMode,
  });
  const ids = new Set(groups.flatMap((g) => g.concepts.map((c) => c.id)));
  const data = sanitizeCanvasData(layoutConceptMap(groups, normalizeLinks(raw, ids)));
  if (!data) throw new ConceptMapError("Couldn't draw the concept map.");
  const canvas = await createCanvas("Concept map", courseId, data);
  return { canvasId: canvas.id };
}
