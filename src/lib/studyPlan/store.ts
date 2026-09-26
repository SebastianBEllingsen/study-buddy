import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  courses,
  db,
  flashcard_reviews,
  generated_items,
  quiz_attempts,
  runTransaction,
  study_plan_chapters,
  study_plan_resources,
  study_plan_sessions,
  study_plans,
} from "../db";
import { positionCases } from "../models";
import type { AiBackend } from "../models";
import { nowUtc } from "../time";
import { parseStudyPlanOptions } from "./options";
import { computeChapterMastery, type ChapterActivity } from "./mastery";
import type {
  ChapterItem,
  ChapterLevel,
  LinkStatus,
  ResourceKind,
  ResourceOrigin,
  StudyPlan,
  StudyPlanChapter,
  StudyPlanOptions,
  StudyPlanResource,
  StudyPlanSession,
  StudyPlanStatus,
  StudyPlanSummary,
  Subtopic,
} from "./types";

// Database access for study plans — kept out of models.ts (already the
// home of every other table's queries, and long) since nothing else reads
// these tables. Same conventions: plain snake_case rows, nowUtc() text
// timestamps, runTransaction for multi-statement writes.

type PlanRow = typeof study_plans.$inferSelect;
type ChapterRow = typeof study_plan_chapters.$inferSelect;
type ResourceRow = typeof study_plan_resources.$inferSelect;

function parseJsonArray<T>(raw: string | null, isItem: (v: unknown) => v is T): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

const isInteger = (v: unknown): v is number => Number.isInteger(v);
const isSubtopic = (v: unknown): v is Subtopic =>
  !!v && typeof v === "object" && typeof (v as Subtopic).text === "string" && typeof (v as Subtopic).done === "boolean";

function toSummary(row: PlanRow): StudyPlanSummary {
  return {
    id: row.id,
    course_id: row.course_id,
    title: row.title,
    status: row.status,
    preset: row.preset,
    options: parseStudyPlanOptions(row.options_json),
    syllabus_document_id: row.syllabus_document_id,
    syllabus_text: row.syllabus_text,
    source_document_ids: parseJsonArray(row.source_document_ids, isInteger),
    source_folder_id: row.source_folder_id,
    source_handpicked: row.source_handpicked,
    language: row.language,
    model_provider: row.model_provider,
    model_name: row.model_name,
    used_web_search: row.used_web_search,
    error_message: row.error_message,
    links_checked_at: row.links_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toResource(row: ResourceRow): StudyPlanResource {
  return { ...row };
}

function toChapter(
  row: ChapterRow,
  resources: StudyPlanResource[],
  practice: { items: ChapterItem[]; mastery: number | null } = { items: [], mastery: null }
): StudyPlanChapter {
  return {
    id: row.id,
    plan_id: row.plan_id,
    position: row.position,
    stage: row.stage,
    title: row.title,
    summary: row.summary,
    subtopics: parseJsonArray(row.subtopics_json, isSubtopic),
    prerequisite_ids: parseJsonArray(row.prerequisite_ids_json, isInteger),
    linked_document_ids: parseJsonArray(row.linked_document_ids_json, isInteger),
    current_level: row.current_level,
    estimated_minutes: row.estimated_minutes,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resources,
    items: practice.items,
    mastery: practice.mastery,
  };
}

// The items generated for these chapters, and each chapter's mastery from
// their quiz and flashcard results — three narrow queries, not per chapter.
async function loadPractice(
  chapterIds: number[],
  tx: typeof db = db
): Promise<Map<number, { items: ChapterItem[]; mastery: number | null }>> {
  const result = new Map<number, { items: ChapterItem[]; mastery: number | null }>();
  if (chapterIds.length === 0) return result;
  const items = await tx
    .select({
      id: generated_items.id,
      mode: generated_items.mode,
      title: generated_items.title,
      created_at: generated_items.created_at,
      chapter_id: generated_items.study_plan_chapter_id,
    })
    .from(generated_items)
    .where(inArray(generated_items.study_plan_chapter_id, chapterIds))
    .orderBy(asc(generated_items.created_at));
  const itemIds = items.map((i) => i.id);
  const attempts = itemIds.length
    ? await tx
        .select({
          item_id: quiz_attempts.generated_item_id,
          score: quiz_attempts.score,
          completed_at: quiz_attempts.completed_at,
        })
        .from(quiz_attempts)
        .where(inArray(quiz_attempts.generated_item_id, itemIds))
    : [];
  const reviews = itemIds.length
    ? await tx
        .select({
          item_id: flashcard_reviews.generated_item_id,
          result: flashcard_reviews.last_result,
          reviewed_at: flashcard_reviews.reviewed_at,
        })
        .from(flashcard_reviews)
        .where(inArray(flashcard_reviews.generated_item_id, itemIds))
    : [];

  const chapterOfItem = new Map(items.map((i) => [i.id, i.chapter_id as number]));
  const activity = new Map<number, ChapterActivity>();
  const activityFor = (chapterId: number) => {
    if (!activity.has(chapterId)) activity.set(chapterId, { quizScores: [], flashcardResults: [] });
    return activity.get(chapterId) as ChapterActivity;
  };
  const bestScore = new Map<number, number>();
  for (const a of attempts) {
    if (a.score === null || !a.completed_at) continue;
    activityFor(chapterOfItem.get(a.item_id) as number).quizScores.push({ score: a.score, at: a.completed_at });
    bestScore.set(a.item_id, Math.max(bestScore.get(a.item_id) ?? 0, a.score));
  }
  for (const r of reviews) {
    activityFor(chapterOfItem.get(r.item_id) as number).flashcardResults.push({ result: r.result, at: r.reviewed_at });
  }

  for (const chapterId of chapterIds) {
    const own = items.filter((i) => i.chapter_id === chapterId);
    const chapterActivity = activity.get(chapterId);
    result.set(chapterId, {
      items: own.map((i) => ({
        id: i.id,
        mode: i.mode,
        title: i.title,
        created_at: i.created_at,
        best_score: bestScore.get(i.id) ?? null,
      })),
      mastery: chapterActivity ? computeChapterMastery(chapterActivity) : null,
    });
  }
  return result;
}

async function loadPlan(row: PlanRow, tx: typeof db = db): Promise<StudyPlan> {
  const chapterRows = await tx
    .select()
    .from(study_plan_chapters)
    .where(eq(study_plan_chapters.plan_id, row.id))
    .orderBy(asc(study_plan_chapters.position), asc(study_plan_chapters.id));
  const chapterIds = chapterRows.map((c) => c.id);
  const resourceRows = chapterIds.length
    ? await tx
        .select()
        .from(study_plan_resources)
        .where(inArray(study_plan_resources.chapter_id, chapterIds))
        .orderBy(asc(study_plan_resources.position), asc(study_plan_resources.id))
    : [];
  const byChapter = new Map<number, StudyPlanResource[]>();
  for (const r of resourceRows) {
    byChapter.set(r.chapter_id, [...(byChapter.get(r.chapter_id) ?? []), toResource(r)]);
  }
  const practice = await loadPractice(chapterIds, tx);
  const sessions = await tx
    .select()
    .from(study_plan_sessions)
    .where(eq(study_plan_sessions.plan_id, row.id))
    .orderBy(asc(study_plan_sessions.date), asc(study_plan_sessions.id));
  return {
    ...toSummary(row),
    chapters: chapterRows.map((c) => toChapter(c, byChapter.get(c.id) ?? [], practice.get(c.id))),
    sessions,
  };
}

export async function getStudyPlan(id: number): Promise<StudyPlan | undefined> {
  const [row] = await db.select().from(study_plans).where(eq(study_plans.id, id)).limit(1);
  return row ? loadPlan(row) : undefined;
}

// Every plan that's finished building, with its course — for the Today
// autopilot, which looks across courses.
export async function listReadyStudyPlans(): Promise<StudyPlan[]> {
  const rows = await db.select().from(study_plans).where(eq(study_plans.status, "ready"));
  return Promise.all(rows.map((row) => loadPlan(row)));
}

export async function getStudyPlanForCourse(courseId: number): Promise<StudyPlan | undefined> {
  const [row] = await db.select().from(study_plans).where(eq(study_plans.course_id, courseId)).limit(1);
  return row ? loadPlan(row) : undefined;
}

// --- Creating / replacing a whole plan ---

export interface NewResource {
  kind: ResourceKind;
  title: string;
  url: string;
  provider: string | null;
  language: string | null;
  note: string;
  origin: ResourceOrigin;
  link_status: LinkStatus;
  status_detail: string | null;
  checked_at: string | null;
}

export interface NewChapter {
  title: string;
  summary: string;
  subtopics: string[];
  // 0-based indexes of earlier chapters in the same list.
  prerequisites: number[];
  stage: number;
  linked_document_ids: number[];
  estimated_minutes: number | null;
  resources: NewResource[];
}

export interface NewStudyPlan {
  courseId: number;
  title: string;
  status: StudyPlanStatus;
  options: StudyPlanOptions;
  syllabusDocumentId: number | null;
  syllabusText: string | null;
  sourceDocumentIds: number[];
  sourceFolderId: number | null;
  sourceHandpicked: boolean;
  language: string;
  modelProvider: AiBackend | null;
  modelName: string | null;
  usedWebSearch: boolean;
  linksCheckedAt: string | null;
  chapters: NewChapter[];
}

function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// What survives a regeneration: per matching chapter title, which subtopics
// were ticked, the user's own added links, and AI links already marked done
// (kept so their done state survives — replaceAiResources keeps done_at
// for a URL the new search suggests again).
interface CarriedProgress {
  doneSubtopics: Set<string>;
  doneUrls: Map<string, string>;
  keptResources: StudyPlanResource[];
}

function collectProgress(previous: StudyPlan | undefined): Map<string, CarriedProgress> {
  const byTitle = new Map<string, CarriedProgress>();
  for (const chapter of previous?.chapters ?? []) {
    byTitle.set(normalizeTitle(chapter.title), {
      doneSubtopics: new Set(chapter.subtopics.filter((s) => s.done).map((s) => normalizeTitle(s.text))),
      doneUrls: new Map(chapter.resources.filter((r) => r.done_at).map((r) => [r.url, r.done_at as string])),
      keptResources: chapter.resources.filter((r) => r.origin === "user" || r.done_at),
    });
  }
  return byTitle;
}

// Creates the course's plan, replacing any existing one (one plan per
// course). Progress on chapters whose title matches one in the old plan
// carries over — ticked subtopics with the same text, done resources with
// the same URL, and hand-added links — so regenerating after a syllabus
// tweak doesn't wipe out work already done.
export async function replaceStudyPlan(plan: NewStudyPlan): Promise<StudyPlan> {
  const now = nowUtc();
  const id = await runTransaction(async (tx) => {
    const [existing] = await tx.select().from(study_plans).where(eq(study_plans.course_id, plan.courseId)).limit(1);
    const carried = collectProgress(existing ? await loadPlan(existing, tx) : undefined);
    if (existing) await tx.delete(study_plans).where(eq(study_plans.id, existing.id));

    const [inserted] = await tx
      .insert(study_plans)
      .values({
        course_id: plan.courseId,
        title: plan.title,
        status: plan.status,
        preset: plan.options.preset,
        options_json: JSON.stringify(plan.options),
        syllabus_document_id: plan.syllabusDocumentId,
        syllabus_text: plan.syllabusText,
        source_document_ids: JSON.stringify(plan.sourceDocumentIds),
        source_folder_id: plan.sourceFolderId,
        source_handpicked: plan.sourceHandpicked,
        language: plan.language,
        model_provider: plan.modelProvider,
        model_name: plan.modelName,
        used_web_search: plan.usedWebSearch,
        links_checked_at: plan.linksCheckedAt,
        created_at: now,
        updated_at: now,
      })
      .returning();

    const chapterIds: number[] = [];
    for (const [index, chapter] of plan.chapters.entries()) {
      const progress = carried.get(normalizeTitle(chapter.title));
      const [row] = await tx
        .insert(study_plan_chapters)
        .values({
          plan_id: inserted.id,
          position: index,
          stage: chapter.stage,
          title: chapter.title,
          summary: chapter.summary,
          subtopics_json: JSON.stringify(
            chapter.subtopics.map((text) => ({ text, done: !!progress?.doneSubtopics.has(normalizeTitle(text)) }))
          ),
          prerequisite_ids_json: JSON.stringify(
            chapter.prerequisites.filter((p) => p >= 0 && p < index).map((p) => chapterIds[p])
          ),
          linked_document_ids_json: JSON.stringify(chapter.linked_document_ids),
          estimated_minutes: chapter.estimated_minutes,
          created_at: now,
          updated_at: now,
        })
        .returning({ id: study_plan_chapters.id });
      chapterIds.push(row.id);

      const aiUrls = new Set(chapter.resources.map((r) => r.url));
      const resources = [
        ...chapter.resources.map((r) => ({ ...r, done_at: progress?.doneUrls.get(r.url) ?? null })),
        // Hand-added and done links from the old chapter, unless the new
        // list already has the same URL.
        ...(progress?.keptResources ?? [])
          .filter((r) => !aiUrls.has(r.url))
          .map((r) => ({
            kind: r.kind,
            title: r.title,
            url: r.url,
            provider: r.provider,
            language: r.language,
            note: r.note,
            origin: r.origin,
            link_status: r.link_status,
            status_detail: r.status_detail,
            checked_at: r.checked_at,
            done_at: r.done_at,
          })),
      ];
      if (resources.length) {
        await tx.insert(study_plan_resources).values(
          resources.map((r, position) => ({ ...r, chapter_id: row.id, position, created_at: now }))
        );
      }
    }
    return inserted.id;
  });
  return (await getStudyPlan(id)) as StudyPlan;
}

export async function renameStudyPlan(id: number, title: string): Promise<void> {
  await db.update(study_plans).set({ title, updated_at: nowUtc() }).where(eq(study_plans.id, id));
}

export async function setPlanOptions(id: number, options: StudyPlanOptions): Promise<void> {
  await db
    .update(study_plans)
    .set({ options_json: JSON.stringify(options), preset: options.preset, updated_at: nowUtc() })
    .where(eq(study_plans.id, id));
}

export async function deleteStudyPlan(id: number): Promise<void> {
  await db.delete(study_plans).where(eq(study_plans.id, id));
}

export async function setPlanStatus(
  id: number,
  status: StudyPlanStatus,
  extra: { errorMessage?: string | null; usedWebSearch?: boolean; linksCheckedAt?: string | null } = {}
): Promise<void> {
  const set: Partial<typeof study_plans.$inferInsert> = { status, updated_at: nowUtc() };
  if (extra.errorMessage !== undefined) set.error_message = extra.errorMessage;
  if (extra.usedWebSearch !== undefined) set.used_web_search = extra.usedWebSearch;
  if (extra.linksCheckedAt !== undefined) set.links_checked_at = extra.linksCheckedAt;
  await db.update(study_plans).set(set).where(eq(study_plans.id, id));
}

// Records what the user said they already know, per chapter. Ids not in
// this plan are ignored.
export async function setChapterLevels(planId: number, levels: Map<number, ChapterLevel>): Promise<void> {
  for (const [chapterId, level] of levels) {
    await db
      .update(study_plan_chapters)
      .set({ current_level: level, updated_at: nowUtc() })
      .where(and(eq(study_plan_chapters.id, chapterId), eq(study_plan_chapters.plan_id, planId)));
  }
}

export async function setPlanLinksCheckedAt(id: number, checkedAt: string): Promise<void> {
  await db.update(study_plans).set({ links_checked_at: checkedAt }).where(eq(study_plans.id, id));
}

// --- Chapters ---

export async function getChapterRow(id: number): Promise<ChapterRow | undefined> {
  const [row] = await db.select().from(study_plan_chapters).where(eq(study_plan_chapters.id, id)).limit(1);
  return row;
}

export async function getChapter(id: number): Promise<StudyPlanChapter | undefined> {
  const row = await getChapterRow(id);
  if (!row) return undefined;
  const resources = await db
    .select()
    .from(study_plan_resources)
    .where(eq(study_plan_resources.chapter_id, id))
    .orderBy(asc(study_plan_resources.position), asc(study_plan_resources.id));
  return toChapter(row, resources.map(toResource), (await loadPractice([id])).get(id));
}

export async function createChapter(
  planId: number,
  fields: {
    title: string;
    summary?: string;
    subtopics?: string[];
    stage?: number;
    prerequisiteIds?: number[];
    linkedDocumentIds?: number[];
    estimatedMinutes?: number | null;
  }
): Promise<StudyPlanChapter> {
  const now = nowUtc();
  const row = await runTransaction(async (tx) => {
    const existing = await tx
      .select({ position: study_plan_chapters.position, stage: study_plan_chapters.stage })
      .from(study_plan_chapters)
      .where(eq(study_plan_chapters.plan_id, planId));
    const nextPosition = existing.reduce((m, c) => Math.max(m, c.position), -1) + 1;
    // New chapters go at the end of the roadmap by default.
    const lastStage = existing.reduce((m, c) => Math.max(m, c.stage), 0);
    const [inserted] = await tx
      .insert(study_plan_chapters)
      .values({
        plan_id: planId,
        position: nextPosition,
        stage: fields.stage ?? lastStage + 1,
        title: fields.title,
        summary: fields.summary ?? "",
        subtopics_json: JSON.stringify((fields.subtopics ?? []).map((text) => ({ text, done: false }))),
        prerequisite_ids_json: JSON.stringify(fields.prerequisiteIds ?? []),
        linked_document_ids_json: JSON.stringify(fields.linkedDocumentIds ?? []),
        estimated_minutes: fields.estimatedMinutes ?? null,
        created_at: now,
        updated_at: now,
      })
      .returning();
    return inserted;
  });
  return toChapter(row, []);
}

export interface ChapterPatch {
  title?: string;
  summary?: string;
  subtopics?: Subtopic[];
  stage?: number;
  linked_document_ids?: number[];
  completed?: boolean;
}

export async function updateChapter(id: number, patch: ChapterPatch): Promise<void> {
  const set: Partial<typeof study_plan_chapters.$inferInsert> = { updated_at: nowUtc() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (patch.subtopics !== undefined) set.subtopics_json = JSON.stringify(patch.subtopics);
  if (patch.stage !== undefined) set.stage = patch.stage;
  if (patch.linked_document_ids !== undefined) set.linked_document_ids_json = JSON.stringify(patch.linked_document_ids);
  if (patch.completed !== undefined) set.completed_at = patch.completed ? nowUtc() : null;
  await db.update(study_plan_chapters).set(set).where(eq(study_plan_chapters.id, id));
}

// Adds subtopics and linked documents to a chapter without touching what's
// there — new subtopics go after the existing ones (unticked), and anything
// already present (same text, same document) is skipped.
export async function extendChapter(
  id: number,
  additions: { subtopics: string[]; documentIds: number[] }
): Promise<void> {
  const row = await getChapterRow(id);
  if (!row) return;
  const chapter = toChapter(row, []);
  const have = new Set(chapter.subtopics.map((s) => normalizeTitle(s.text)));
  const subtopics = [...chapter.subtopics];
  for (const text of additions.subtopics) {
    if (have.has(normalizeTitle(text))) continue;
    have.add(normalizeTitle(text));
    subtopics.push({ text, done: false });
  }
  const documentIds = [...new Set([...chapter.linked_document_ids, ...additions.documentIds])];
  await updateChapter(id, { subtopics, linked_document_ids: documentIds });
}

export async function setPlanSourceDocumentIds(id: number, documentIds: number[]): Promise<void> {
  await db
    .update(study_plans)
    .set({ source_document_ids: JSON.stringify(documentIds), updated_at: nowUtc() })
    .where(eq(study_plans.id, id));
}

export async function deleteChapter(id: number): Promise<void> {
  await db.delete(study_plan_chapters).where(eq(study_plan_chapters.id, id));
}

export async function reorderChapters(planId: number, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(study_plan_chapters)
    .set({ position: positionCases(study_plan_chapters.id, orderedIds) })
    .where(and(eq(study_plan_chapters.plan_id, planId), inArray(study_plan_chapters.id, orderedIds)));
}

// --- Resources ---

export async function getResourceRow(id: number): Promise<ResourceRow | undefined> {
  const [row] = await db.select().from(study_plan_resources).where(eq(study_plan_resources.id, id)).limit(1);
  return row;
}

export async function addResource(chapterId: number, resource: NewResource): Promise<StudyPlanResource> {
  const row = await runTransaction(async (tx) => {
    const existing = await tx
      .select({ position: study_plan_resources.position })
      .from(study_plan_resources)
      .where(eq(study_plan_resources.chapter_id, chapterId));
    const [inserted] = await tx
      .insert(study_plan_resources)
      .values({
        ...resource,
        chapter_id: chapterId,
        position: existing.reduce((m, r) => Math.max(m, r.position), -1) + 1,
        created_at: nowUtc(),
      })
      .returning();
    return inserted;
  });
  return toResource(row);
}

export interface ResourcePatch {
  title?: string;
  url?: string;
  kind?: ResourceKind;
  note?: string;
  done?: boolean;
}

export async function updateResource(id: number, patch: ResourcePatch): Promise<void> {
  const set: Partial<typeof study_plan_resources.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.url !== undefined) {
    set.url = patch.url;
    // A new URL hasn't been checked.
    set.link_status = "unchecked";
    set.status_detail = null;
    set.checked_at = null;
  }
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.done !== undefined) set.done_at = patch.done ? nowUtc() : null;
  if (Object.keys(set).length === 0) return;
  await db.update(study_plan_resources).set(set).where(eq(study_plan_resources.id, id));
}

export async function setResourceLinkCheck(
  id: number,
  check: { status: LinkStatus; detail: string | null; url: string }
): Promise<void> {
  await db
    .update(study_plan_resources)
    .set({ link_status: check.status, status_detail: check.detail, url: check.url, checked_at: nowUtc() })
    .where(eq(study_plan_resources.id, id));
}

export async function deleteResource(id: number): Promise<void> {
  await db.delete(study_plan_resources).where(eq(study_plan_resources.id, id));
}

export async function reorderResources(chapterId: number, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(study_plan_resources)
    .set({ position: positionCases(study_plan_resources.id, orderedIds) })
    .where(and(eq(study_plan_resources.chapter_id, chapterId), inArray(study_plan_resources.id, orderedIds)));
}

// "Find different resources" for one chapter (and the resource step of
// building a plan): swaps out every AI-suggested link for the new list,
// keeping the user's own. New AI links come first
// (in their study order), hand-added ones after, in their existing order.
export async function replaceAiResources(chapterId: number, resources: NewResource[]): Promise<void> {
  const now = nowUtc();
  await runTransaction(async (tx) => {
    // A re-suggested URL keeps its done mark.
    const previousAi = await tx
      .select({ url: study_plan_resources.url, done_at: study_plan_resources.done_at })
      .from(study_plan_resources)
      .where(and(eq(study_plan_resources.chapter_id, chapterId), eq(study_plan_resources.origin, "ai")));
    const doneByUrl = new Map(previousAi.filter((r) => r.done_at).map((r) => [r.url, r.done_at]));
    const kept = await tx
      .select({ id: study_plan_resources.id, url: study_plan_resources.url })
      .from(study_plan_resources)
      .where(and(eq(study_plan_resources.chapter_id, chapterId), eq(study_plan_resources.origin, "user")))
      .orderBy(asc(study_plan_resources.position), asc(study_plan_resources.id));
    await tx
      .delete(study_plan_resources)
      .where(and(eq(study_plan_resources.chapter_id, chapterId), eq(study_plan_resources.origin, "ai")));
    const keptUrls = new Set(kept.map((k) => k.url));
    const fresh = resources.filter((r) => !keptUrls.has(r.url));
    if (fresh.length) {
      await tx.insert(study_plan_resources).values(
        fresh.map((r, position) => ({
          ...r,
          chapter_id: chapterId,
          position,
          done_at: doneByUrl.get(r.url) ?? null,
          created_at: now,
        }))
      );
    }
    for (const [i, k] of kept.entries()) {
      await tx
        .update(study_plan_resources)
        .set({ position: fresh.length + i })
        .where(eq(study_plan_resources.id, k.id));
    }
  });
}

// --- Schedule sessions ---

export interface NewSession {
  chapterId: number;
  date: string;
  minutes: number;
  kind: "study" | "review";
}

// Swaps the plan's not-yet-done sessions for a freshly built schedule.
// Finished sessions stay as the record of work done (and count toward
// each chapter's done minutes next time).
export async function replaceOpenSessions(planId: number, sessions: NewSession[]): Promise<void> {
  const now = nowUtc();
  await runTransaction(async (tx) => {
    await tx
      .delete(study_plan_sessions)
      .where(and(eq(study_plan_sessions.plan_id, planId), isNull(study_plan_sessions.done_at)));
    if (sessions.length) {
      await tx.insert(study_plan_sessions).values(
        sessions.map((s) => ({
          plan_id: planId,
          chapter_id: s.chapterId,
          date: s.date,
          minutes: s.minutes,
          kind: s.kind,
          created_at: now,
        }))
      );
    }
  });
}

export async function getSession(id: number): Promise<StudyPlanSession | undefined> {
  const [row] = await db.select().from(study_plan_sessions).where(eq(study_plan_sessions.id, id)).limit(1);
  return row;
}

export async function setSessionDone(id: number, done: boolean): Promise<void> {
  await db
    .update(study_plan_sessions)
    .set({ done_at: done ? nowUtc() : null })
    .where(eq(study_plan_sessions.id, id));
}

export async function setSessionGoogleEventId(id: number, eventId: string | null): Promise<void> {
  await db.update(study_plan_sessions).set({ google_event_id: eventId }).where(eq(study_plan_sessions.id, id));
}

export async function deleteAllSessions(planId: number): Promise<void> {
  await db.delete(study_plan_sessions).where(eq(study_plan_sessions.plan_id, planId));
}

export interface CalendarSessionRow {
  id: number;
  date: string;
  minutes: number;
  kind: "study" | "review";
  chapter_id: number;
  chapter_title: string;
  course_id: number;
  course_name: string;
}

// Open sessions from `fromDate` through `toDate`, across every plan — for
// the app's own calendar views. Sessions already pushed to Google Calendar
// are left out: they come back through the Google listing instead.
export async function listCalendarSessions(fromDate: string, toDate: string): Promise<CalendarSessionRow[]> {
  return db
    .select({
      id: study_plan_sessions.id,
      date: study_plan_sessions.date,
      minutes: study_plan_sessions.minutes,
      kind: study_plan_sessions.kind,
      chapter_id: study_plan_sessions.chapter_id,
      chapter_title: study_plan_chapters.title,
      course_id: study_plans.course_id,
      course_name: courses.name,
    })
    .from(study_plan_sessions)
    .innerJoin(study_plan_chapters, eq(study_plan_chapters.id, study_plan_sessions.chapter_id))
    .innerJoin(study_plans, eq(study_plans.id, study_plan_sessions.plan_id))
    .innerJoin(courses, eq(courses.id, study_plans.course_id))
    .where(
      and(
        isNull(study_plan_sessions.done_at),
        isNull(study_plan_sessions.google_event_id),
        gte(study_plan_sessions.date, fromDate),
        lte(study_plan_sessions.date, toDate)
      )
    )
    .orderBy(asc(study_plan_sessions.date));
}
