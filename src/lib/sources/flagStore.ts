import { and, eq, isNull } from "drizzle-orm";
import { db, mistakes, review_items } from "../db";
import {
  getAppSettings,
  getCourse,
  getDocument,
  getGeneratedItem,
  getNote,
  listGeneratedItemsForCourse,
  reconcileFlashcardReviewsAfterRemoval,
  updateGeneratedItemContent,
  type GeneratedItem,
} from "../models";
import { reconcileReviewItemsAfterRemoval } from "../review/store";
import { ensureFsrsMigrated } from "../review/legacyMigration";
import { generateStructured } from "../aiClient";
import { languageName } from "../languages";
import { documentSource, noteSource, combineSources } from "../context";
import { fixItemSystemPrompt, fixItemUserPrompt, normalizeFixSuggestion, type FixSuggestion } from "../prompts/fixItem";
import { nowUtc } from "../time";
import type { ReviewItemKind } from "../review/types";
import type { SourceRef } from "../types";
import {
  entriesOf,
  FlagError,
  flaggedEntries,
  keepEntry,
  removeEntry,
  replaceEntry,
  reportEntry,
  type FlaggableContent,
  type FlaggableMode,
  type FlaggedEntry,
} from "./flags";

// The database side of flagged items: reporting one wrong from review,
// resolving flags from the item or sources page, and the AI fix suggestion.

// Enough of a source for the fix suggestion to check against, without
// sending a whole textbook for one card.
const FIX_MATERIAL_CHARS = 120_000;

interface Loaded {
  item: GeneratedItem;
  mode: FlaggableMode;
  kind: ReviewItemKind;
  content: FlaggableContent;
}

async function load(itemId: number): Promise<Loaded> {
  const item = await getGeneratedItem(itemId);
  if (!item) throw new FlagError("Item not found");
  if (item.mode !== "flashcards" && item.mode !== "quiz") throw new FlagError("Only cards and quiz questions can be flagged.");
  return {
    item,
    mode: item.mode,
    kind: item.mode === "flashcards" ? "card" : "question",
    content: JSON.parse(item.content_json) as FlaggableContent,
  };
}

async function save(loaded: Loaded, content: FlaggableContent) {
  await updateGeneratedItemContent({
    id: loaded.item.id,
    contentJson: content,
    sourceDocumentIds: JSON.parse(loaded.item.source_document_ids) as number[],
  });
}

// A wrong item's open mistakes weren't the student's mistakes.
async function dropOpenMistakes(itemId: number, kind: ReviewItemKind, index: number) {
  await db
    .delete(mistakes)
    .where(
      and(
        eq(mistakes.generated_item_id, itemId),
        eq(mistakes.kind, kind),
        eq(mistakes.item_index, index),
        isNull(mistakes.resolved_at)
      )
    );
}

export async function reportItemWrong(itemId: number, index: number, issue: string): Promise<void> {
  const loaded = await load(itemId);
  await save(loaded, reportEntry(loaded.mode, loaded.content, index, issue, new Date().toISOString()));
  await dropOpenMistakes(itemId, loaded.kind, index);
}

export type FlagResolution = { action: "keep" } | { action: "remove" } | { action: "save"; entry: unknown };

export async function resolveFlag(itemId: number, index: number, resolution: FlagResolution): Promise<void> {
  const loaded = await load(itemId);
  if (resolution.action === "keep") {
    await save(loaded, keepEntry(loaded.mode, loaded.content, index));
    return;
  }
  if (resolution.action === "remove") {
    await save(loaded, removeEntry(loaded.mode, loaded.content, index));
    // review_items and mistakes are keyed by position, so everything after
    // the removed item shifts down. (Past quiz attempts' stored results
    // aren't read back anywhere, so they're left as they were.)
    await ensureFsrsMigrated();
    await reconcileReviewItemsAfterRemoval(itemId, loaded.kind, [index]);
    if (loaded.mode === "flashcards") await reconcileFlashcardReviewsAfterRemoval(itemId, [index]);
    return;
  }
  await save(loaded, replaceEntry(loaded.mode, loaded.content, index, resolution.entry));
  // What was learned from the old version was wrong: bring the corrected
  // one up for review right away.
  await db
    .update(review_items)
    .set({ due_at: nowUtc() })
    .where(
      and(eq(review_items.generated_item_id, itemId), eq(review_items.kind, loaded.kind), eq(review_items.item_index, index))
    );
  await dropOpenMistakes(itemId, loaded.kind, index);
}

async function sourceMaterial(source: SourceRef | undefined, courseId: number): Promise<string | undefined> {
  if (!source) return undefined;
  if (source.kind === "document") {
    const doc = await getDocument(source.id);
    if (!doc || doc.course_id !== courseId || !doc.extracted_text) return undefined;
    return combineSources([documentSource(doc)]).slice(0, FIX_MATERIAL_CHARS);
  }
  const note = await getNote(source.id);
  if (!note || note.course_id !== courseId) return undefined;
  return combineSources([noteSource(note, note.generation_source ?? "personal")]).slice(0, FIX_MATERIAL_CHARS);
}

export async function suggestFix(itemId: number, index: number): Promise<FixSuggestion> {
  const loaded = await load(itemId);
  const entry = entriesOf(loaded.mode, loaded.content)[index];
  if (!entry) throw new FlagError("That item no longer exists.");
  const [settings, course, material] = await Promise.all([
    getAppSettings(),
    getCourse(loaded.item.course_id),
    sourceMaterial(entry.source, loaded.item.course_id),
  ]);
  const raw = await generateStructured<unknown>({
    system: fixItemSystemPrompt(course?.name ?? "this course", loaded.mode, languageName(settings.preferredLanguage)),
    user: fixItemUserPrompt(loaded.mode, entry, entry.flag?.issue ?? "Reported as possibly wrong.", material),
    maxTokens: 2000,
    effort: settings.aiEfficiencyMode ? "low" : "medium",
    efficient: settings.aiEfficiencyMode,
  });
  return normalizeFixSuggestion(raw, loaded.mode);
}

export interface CourseFlag extends FlaggedEntry {
  itemId: number;
  itemTitle: string;
  mode: FlaggableMode;
}

export async function listCourseFlags(courseId: number): Promise<CourseFlag[]> {
  const items = await listGeneratedItemsForCourse(courseId);
  return items.flatMap((item) => {
    if (item.mode !== "flashcards" && item.mode !== "quiz") return [];
    const mode = item.mode;
    return flaggedEntries(mode, JSON.parse(item.content_json) as FlaggableContent).map((f) => ({
      ...f,
      itemId: item.id,
      itemTitle: item.title,
      mode,
    }));
  });
}
