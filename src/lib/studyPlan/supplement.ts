import { generateStructured } from "../aiClient";
import {
  getAppSettings,
  getCourse,
  listDocumentsForCourse,
  listFoldersForCourse,
  listNotesForCourse,
  type DocumentRow,
  type Note,
} from "../models";
import { normalizeStudyPlanSupplement } from "../aiResponseValidation";
import { studyPlanSupplementSystemPrompt, studyPlanSupplementUserPrompt } from "../prompts/studyPlan";
import { subtreeFolderIds } from "../folderTree";
import { languageName } from "../languages";
import { mapWithConcurrency } from "../concurrency";
import { buildPlanMaterialDigests, noteFingerprint } from "./planMaterial";
import { matchDocumentIds, matchNoteIds } from "./generatePlan";
import { findChapterResources, StudyPlanNotFoundError } from "./resources";
import {
  createChapter,
  extendChapter,
  getStudyPlan,
  replaceAiResources,
  setPlanSourceMaterial,
} from "./store";
import { rescheduleQuietly } from "./scheduleService";
import type { StudyPlan } from "./types";

// Keeping a plan current as a course goes on: documents and notes added after the
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

// Unseen, or edited since the plan saw it. A "" fingerprint is a note the
// plan saw before fingerprints were kept: seen, not comparable.
function isNewOrEdited(note: Note, seen: Record<number, string>): boolean {
  const seenFingerprint = seen[note.id];
  if (seenFingerprint === undefined) return true;
  return seenFingerprint !== "" && seenFingerprint !== noteFingerprint(note);
}

export interface NewPlanMaterial {
  documents: DocumentRow[];
  notes: Note[];
}

// Extracted documents, and notes marked for generation, in the plan's
// material scope that it hasn't seen yet. A folder-scoped plan watches that
// folder and its subfolders; any other plan (all material, or a
// hand-picked set) watches the whole course, since that's where a new
// lecture would land. Plans built before notes were tracked have seen none,
// so their existing notes show up here once; a note edited after the plan
// saw it shows up again.
export async function findNewPlanMaterial(plan: StudyPlan): Promise<NewPlanMaterial> {
  const seenDocs = new Set(plan.source_document_ids);
  if (plan.syllabus_document_id !== null) seenDocs.add(plan.syllabus_document_id);
  const seenNotes = plan.source_notes;
  let inScope: (item: { folder_id: number | null }) => boolean = () => true;
  if (plan.source_folder_id !== null) {
    const folderIds = new Set(subtreeFolderIds(await listFoldersForCourse(plan.course_id), plan.source_folder_id));
    inScope = (item) => item.folder_id !== null && folderIds.has(item.folder_id);
  }
  const [documents, notes] = await Promise.all([
    listDocumentsForCourse(plan.course_id),
    listNotesForCourse(plan.course_id),
  ]);
  return {
    documents: documents.filter(
      (d) => d.status === "extracted" && !!d.extracted_text && !seenDocs.has(d.id) && inScope(d)
    ),
    notes: notes.filter((n) => !!n.generation_source && n.markdown.trim() !== "" && isNewOrEdited(n, seenNotes) && inScope(n)),
  };
}

export interface SupplementResult {
  plan: StudyPlan;
  updatedChapters: number;
  addedChapters: number;
}

export async function supplementStudyPlan(planId: number): Promise<SupplementResult> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();
  const { documents: newDocs, notes: newNotes } = await findNewPlanMaterial(plan);
  if (newDocs.length === 0 && newNotes.length === 0) throw new NoNewMaterialError();

  const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
  const language = languageName(preferredLanguage);
  const course = await getCourse(plan.course_id);
  const courseName = course?.name ?? plan.title;
  const chapters = [...plan.chapters].sort((a, b) => a.position - b.position);

  const digests = buildPlanMaterialDigests(newDocs, newNotes);

  const supplement = normalizeStudyPlanSupplement(
    await generateStructured<unknown>({
      system: studyPlanSupplementSystemPrompt(courseName, language, digests.assessments !== ""),
      user: studyPlanSupplementUserPrompt(
        chapters.map((c) => ({ title: c.title, subtopics: c.subtopics.map((s) => s.text) })),
        digests.material,
        digests.assessments
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
    const noteIds = matchNoteIds(update.matchedDocuments, newNotes);
    if (update.newSubtopics.length === 0 && documentIds.length === 0 && noteIds.length === 0) continue;
    await extendChapter(chapter.id, { subtopics: update.newSubtopics, documentIds, noteIds });
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
        linkedNoteIds: matchNoteIds(chapter.matchedDocuments, newNotes),
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

  // Every new document and note counts as seen now, matched to a chapter or
  // not, so the "new material" prompt goes away.
  await setPlanSourceMaterial(planId, {
    documentIds: [...plan.source_document_ids, ...newDocs.map((d) => d.id)],
    notes: { ...plan.source_notes, ...Object.fromEntries(newNotes.map((n) => [n.id, noteFingerprint(n)])) },
  });
  if (plan.options.schedule && (created.length || updatedChapters)) await rescheduleQuietly(planId);
  return { plan: (await getStudyPlan(planId)) as StudyPlan, updatedChapters, addedChapters: created.length };
}
