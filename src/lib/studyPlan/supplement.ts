import { generateStructured } from "../aiClient";
import { getAppSettings, getCourse, listDocumentsForCourse, listFoldersForCourse, type DocumentRow } from "../models";
import { normalizeStudyPlanSupplement } from "../aiResponseValidation";
import { studyPlanSupplementSystemPrompt, studyPlanSupplementUserPrompt } from "../prompts/studyPlan";
import { subtreeFolderIds } from "../folderTree";
import { languageName } from "../languages";
import { mapWithConcurrency } from "../concurrency";
import { buildMaterialDigest } from "./materialDigest";
import { matchDocumentIds } from "./generatePlan";
import { findChapterResources, StudyPlanNotFoundError } from "./resources";
import {
  createChapter,
  extendChapter,
  getStudyPlan,
  replaceAiResources,
  setPlanSourceDocumentIds,
} from "./store";
import { rescheduleQuietly } from "./scheduleService";
import type { StudyPlan } from "./types";

// Keeping a plan current as a course goes on: documents added after the
// plan was built (new lectures, extra notes) are folded in without
// rebuilding — existing chapters gain subtopics and linked documents, and
// genuinely new topics become new chapters at the end of the roadmap, with
// their own resources. Nothing the student is working through is changed
// or removed, so their progress stays put.

export class NoNewMaterialError extends Error {
  constructor() {
    super("There's no new course material since this plan was built.");
    this.name = "NoNewMaterialError";
  }
}

// Extracted documents in the plan's material scope that it hasn't seen
// yet. A folder-scoped plan watches that folder and its subfolders; any
// other plan (all material, or a hand-picked set) watches the whole course,
// since that's where a new lecture would land.
export async function findNewPlanDocuments(plan: StudyPlan): Promise<DocumentRow[]> {
  const seen = new Set(plan.source_document_ids);
  if (plan.syllabus_document_id !== null) seen.add(plan.syllabus_document_id);
  let inScope: (doc: DocumentRow) => boolean = () => true;
  if (plan.source_folder_id !== null) {
    const folderIds = new Set(subtreeFolderIds(await listFoldersForCourse(plan.course_id), plan.source_folder_id));
    inScope = (doc) => doc.folder_id !== null && folderIds.has(doc.folder_id);
  }
  return (await listDocumentsForCourse(plan.course_id)).filter(
    (d) => d.status === "extracted" && !!d.extracted_text && !seen.has(d.id) && inScope(d)
  );
}

export interface SupplementResult {
  plan: StudyPlan;
  updatedChapters: number;
  addedChapters: number;
}

export async function supplementStudyPlan(planId: number): Promise<SupplementResult> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();
  const newDocs = await findNewPlanDocuments(plan);
  if (newDocs.length === 0) throw new NoNewMaterialError();

  const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
  const language = languageName(preferredLanguage);
  const course = await getCourse(plan.course_id);
  const courseName = course?.name ?? plan.title;
  const chapters = [...plan.chapters].sort((a, b) => a.position - b.position);

  const supplement = normalizeStudyPlanSupplement(
    await generateStructured<unknown>({
      system: studyPlanSupplementSystemPrompt(courseName, language),
      user: studyPlanSupplementUserPrompt(
        chapters.map((c) => ({ title: c.title, subtopics: c.subtopics.map((s) => s.text) })),
        buildMaterialDigest(newDocs)
      ),
      maxTokens: efficient ? 4000 : 8000,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );

  let updatedChapters = 0;
  for (const update of supplement.updates) {
    const chapter = chapters[update.chapter - 1];
    if (!chapter) continue;
    const documentIds = matchDocumentIds(update.matchedDocuments, newDocs);
    if (update.newSubtopics.length === 0 && documentIds.length === 0) continue;
    await extendChapter(chapter.id, { subtopics: update.newSubtopics, documentIds });
    updatedChapters++;
  }

  // New chapters go after everything they build on — or, building on
  // nothing, after the current last stage, since new material usually
  // arrives later in a course.
  const lastStage = chapters.reduce((m, c) => Math.max(m, c.stage), 0);
  const created = [];
  for (const chapter of supplement.newChapters) {
    const prerequisites = chapter.prerequisites
      .map((n) => chapters[n - 1])
      .filter((c): c is (typeof chapters)[number] => !!c);
    const stage = prerequisites.length ? Math.max(...prerequisites.map((c) => c.stage)) + 1 : lastStage + 1;
    created.push(
      await createChapter(planId, {
        title: chapter.title,
        summary: chapter.summary,
        subtopics: chapter.subtopics,
        stage,
        prerequisiteIds: prerequisites.map((c) => c.id),
        linkedDocumentIds: matchDocumentIds(chapter.matchedDocuments, newDocs),
        estimatedMinutes: chapter.estimatedMinutes,
      })
    );
  }

  if (plan.options.webResources && created.length) {
    await mapWithConcurrency(created, 3, async (chapter) => {
      try {
        const found = await findChapterResources(
          courseName,
          { title: chapter.title, summary: chapter.summary, subtopics: chapter.subtopics.map((s) => s.text) },
          { languageName: language, density: plan.options.density, efficient }
        );
        await replaceAiResources(chapter.id, found.resources);
      } catch (err) {
        console.error(`Study plan: resource search failed for "${chapter.title}":`, err);
      }
    });
  }

  // Every new document counts as seen now, matched to a chapter or not, so
  // the "new material" prompt goes away.
  await setPlanSourceDocumentIds(planId, [...plan.source_document_ids, ...newDocs.map((d) => d.id)]);
  if (plan.options.schedule && (created.length || updatedChapters)) await rescheduleQuietly(planId);
  return { plan: (await getStudyPlan(planId)) as StudyPlan, updatedChapters, addedChapters: created.length };
}
