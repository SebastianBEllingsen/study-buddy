import { buildCourseContext } from "../context";
import { generateStructured, getModelInfo } from "../aiClient";
import { getAppSettings, getCourse, getDocument, listDocumentsForCourse } from "../models";
import { normalizeStudyPlanOutline } from "../aiResponseValidation";
import { languageName } from "../languages";
import { mapWithConcurrency } from "../concurrency";
import { nowUtc } from "../time";
import {
  MAX_SYLLABUS_CHARS,
  studyPlanOutlineSystemPrompt,
  studyPlanOutlineUserPrompt,
} from "../prompts/studyPlan";
import { buildMaterialDigest } from "./materialDigest";
import { resolveStages } from "./roadmap";
import { findChapterResources, StudyPlanNotFoundError } from "./resources";
import { rescheduleQuietly } from "./scheduleService";
import {
  getStudyPlan,
  replaceAiResources,
  replaceStudyPlan,
  setChapterLevels,
  setPlanStatus,
  type NewChapter,
} from "./store";
import type { ChapterLevel, PlanOutline, StudyPlan, StudyPlanOptions } from "./types";

// Builds a course's study plan in two parts:
//
// 1. createStudyPlanForCourse — syllabus + material → an outline of chapters
//    (one AI call), saved right away, replacing any previous plan.
// 2. buildPlanResources — web resources per chapter (one call each, every
//    link verified), written into the saved plan chapter by chapter.
//
// With the "mark what I know" option on, the plan stops after part 1 in
// status "draft_topics" and the plan page asks the user for their level per
// chapter before part 2 runs; otherwise both run back to back.

export type SyllabusSource = { documentId: number } | { text: string } | null;

export class NoCurriculumError extends Error {
  constructor() {
    super("Add a syllabus, or upload course documents that extract successfully, before building a study plan.");
    this.name = "NoCurriculumError";
  }
}

export class SyllabusNotFoundError extends Error {
  constructor() {
    super("That syllabus document isn't in this course, or its text couldn't be extracted.");
    this.name = "SyllabusNotFoundError";
  }
}

const OUTLINE_MAX_TOKENS = 12_000;
const EFFICIENT_OUTLINE_MAX_TOKENS = 6000;
const RESOURCE_CONCURRENCY = 3;

async function resolveSyllabus(
  courseId: number,
  source: SyllabusSource
): Promise<{ text: string | null; documentId: number | null }> {
  if (!source) return { text: null, documentId: null };
  if ("documentId" in source) {
    const doc = await getDocument(source.documentId);
    if (!doc || doc.course_id !== courseId || doc.status !== "extracted" || !doc.extracted_text?.trim()) {
      throw new SyllabusNotFoundError();
    }
    return { text: doc.extracted_text.slice(0, MAX_SYLLABUS_CHARS), documentId: doc.id };
  }
  const text = source.text.trim().slice(0, MAX_SYLLABUS_CHARS);
  return { text: text || null, documentId: null };
}

// The model names matching documents by filename; only filenames from the
// in-scope list it was shown map back to ids — anything else is dropped.
export function matchDocumentIds(filenames: string[], documents: { id: number; filename: string }[]): number[] {
  const byName = new Map(documents.map((d) => [d.filename.trim().toLowerCase(), d.id]));
  const ids = filenames
    .map((f) => byName.get(f.trim().toLowerCase()))
    .filter((id): id is number => id !== undefined);
  return [...new Set(ids)];
}

export async function createStudyPlanForCourse(
  courseId: number,
  input: {
    syllabus: SyllabusSource;
    folderId?: number | null;
    documentIds?: number[] | null;
    options: StudyPlanOptions;
  }
): Promise<StudyPlan> {
  const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
  const language = languageName(preferredLanguage);

  const syllabus = await resolveSyllabus(courseId, input.syllabus);
  const context = await buildCourseContext(courseId, { folderId: input.folderId, documentIds: input.documentIds });
  const inScope = new Set(context.documentIds);
  // The syllabus document itself is the plan's backbone, not a chapter's
  // reading — keep it out of the material list.
  const documents = (await listDocumentsForCourse(courseId)).filter(
    (d) => inScope.has(d.id) && d.id !== syllabus.documentId
  );
  if (!syllabus.text && documents.length === 0) throw new NoCurriculumError();

  const outline: PlanOutline = normalizeStudyPlanOutline(
    await generateStructured<unknown>({
      system: studyPlanOutlineSystemPrompt(context.courseName, language, {
        hasSyllabus: !!syllabus.text,
        hasMaterial: documents.length > 0,
      }),
      user: studyPlanOutlineUserPrompt(syllabus.text, buildMaterialDigest(documents)),
      maxTokens: efficient ? EFFICIENT_OUTLINE_MAX_TOKENS : OUTLINE_MAX_TOKENS,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );

  // The outline's 1-based prerequisite numbers → 0-based indexes.
  const prerequisites = outline.chapters.map((c) => c.prerequisites.map((p) => p - 1));
  const stages = resolveStages(outline.chapters.map((c, i) => ({ stage: c.stage, prerequisites: prerequisites[i] })));
  const chapters: NewChapter[] = outline.chapters.map((chapter, i) => ({
    title: chapter.title,
    summary: chapter.summary,
    subtopics: chapter.subtopics,
    prerequisites: prerequisites[i],
    stage: stages[i],
    linked_document_ids: matchDocumentIds(chapter.matchedDocuments, documents),
    estimated_minutes: chapter.estimatedMinutes,
    resources: [],
  }));

  const model = await getModelInfo(efficient);
  const plan = await replaceStudyPlan({
    courseId,
    title: outline.title,
    status: input.options.topicLevels ? "draft_topics" : "generating",
    options: input.options,
    syllabusDocumentId: syllabus.documentId,
    syllabusText: input.syllabus && "text" in input.syllabus ? syllabus.text : null,
    sourceDocumentIds: documents.map((d) => d.id),
    sourceFolderId: context.folderId,
    sourceHandpicked: context.handpicked,
    language: preferredLanguage,
    modelProvider: model.provider,
    modelName: model.model,
    usedWebSearch: false,
    linksCheckedAt: null,
    chapters,
  });
  if (input.options.topicLevels) return plan;
  return buildPlanResources(plan.id, new Map());
}

// Part 2: applies the user's per-chapter levels, then finds each chapter's
// resources. Saves chapter by chapter, so a plan page polling while this
// runs fills in as it goes. Marks the plan "failed" (with the reason) if
// something unexpected stops it, so it can be retried from the plan page.
export async function buildPlanResources(planId: number, levels: Map<number, ChapterLevel>): Promise<StudyPlan> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();

  try {
    await setChapterLevels(planId, levels);
    await setPlanStatus(planId, "generating", { errorMessage: null });

    let usedWebSearch = false;
    if (plan.options.webResources) {
      const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
      const course = await getCourse(plan.course_id);
      await mapWithConcurrency(plan.chapters, RESOURCE_CONCURRENCY, async (chapter) => {
        try {
          const found = await findChapterResources(
            course?.name ?? plan.title,
            {
              title: chapter.title,
              summary: chapter.summary,
              subtopics: chapter.subtopics.map((s) => s.text),
              level: levels.get(chapter.id) ?? chapter.current_level,
            },
            { languageName: languageName(preferredLanguage), density: plan.options.density, efficient }
          );
          usedWebSearch ||= found.searched;
          await replaceAiResources(chapter.id, found.resources);
        } catch (err) {
          // One chapter's search failing (a timeout, a malformed answer)
          // shouldn't sink the whole plan — it stays without links, and
          // "Find different resources" on that chapter can try again.
          console.error(`Study plan: resource search failed for "${chapter.title}":`, err);
        }
      });
    }

    await setPlanStatus(planId, "ready", {
      usedWebSearch,
      linksCheckedAt: plan.options.webResources ? nowUtc() : null,
    });
    if (plan.options.schedule) await rescheduleQuietly(planId);
  } catch (err) {
    await setPlanStatus(planId, "failed", {
      errorMessage: err instanceof Error ? err.message : "Building the plan failed.",
    });
    throw err;
  }
  return (await getStudyPlan(planId)) as StudyPlan;
}
