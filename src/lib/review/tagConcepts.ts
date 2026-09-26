import { and, eq, or } from "drizzle-orm";
import { db, generated_items } from "../db";
import { generateStructured } from "../aiClient";
import { getAppSettings, getCourse, updateGeneratedItemContent } from "../models";
import { InvalidAiResponseError } from "../aiResponseValidation";
import { cleanConceptName, conceptKey } from "../conceptName";
import { conceptTagSystemPrompt, conceptTagUserPrompt } from "../prompts/concepts";
import { getStudyPlanForCourse } from "../studyPlan/store";
import type { FlashcardsContent, QuizContent } from "../types";
import { findOrCreateConcepts, listConceptsForCourse } from "./concepts";
import { setConceptIds } from "./store";
import type { ReviewItemKind } from "./types";

// Tags a course's existing cards and questions that have no concept yet —
// items generated before concept tags existed, or imported decks. One AI
// call per generated item, a few items per run so a request stays short;
// the caller repeats until nothing is left. Study plan subtopics are
// offered as the preferred names, so concepts line up with the plan.

export const TAG_ITEMS_PER_RUN = 5;
const MAX_KNOWN_CONCEPTS = 80;

type TaggableContent = FlashcardsContent | QuizContent;

export interface UntaggedEntry {
  index: number;
  prompt: string;
  answer: string;
}

export function untaggedEntries(mode: string, content: TaggableContent): UntaggedEntry[] {
  if (mode === "flashcards") {
    return (content as FlashcardsContent).cards
      .map((c, index) => ({ index, prompt: c.front, answer: c.back, tagged: !!cleanConceptName(c.concept) }))
      .filter((e) => !e.tagged)
      .map(({ index, prompt, answer }) => ({ index, prompt, answer }));
  }
  return (content as QuizContent).questions
    .map((q, index) => ({
      index,
      prompt: q.question,
      answer:
        q.type === "short_answer"
          ? q.modelAnswer
          : q.type === "mcq"
            ? q.options[q.correctIndex]
            : q.correctIndices.map((i) => q.options[i]).join(", "),
      tagged: !!cleanConceptName(q.concept),
    }))
    .filter((e) => !e.tagged)
    .map(({ index, prompt, answer }) => ({ index, prompt, answer }));
}

export function normalizeConceptTags(raw: unknown, count: number): Map<number, string> {
  const tags = (raw as { tags?: unknown })?.tags;
  if (!Array.isArray(tags)) throw new InvalidAiResponseError("missing tags");
  const out = new Map<number, string>();
  for (const entry of tags) {
    const n = (entry as { n?: unknown })?.n;
    const name = cleanConceptName((entry as { concept?: unknown })?.concept);
    if (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count && name) out.set(n as number, name);
  }
  return out;
}

// Writes tags into the content (a new copy); `tags` is keyed by content index.
export function applyConceptTags(mode: string, content: TaggableContent, tags: Map<number, string>): TaggableContent {
  if (mode === "flashcards") {
    const deck = content as FlashcardsContent;
    return { ...deck, cards: deck.cards.map((c, i) => (tags.has(i) ? { ...c, concept: tags.get(i) } : c)) };
  }
  const quiz = content as QuizContent;
  return { ...quiz, questions: quiz.questions.map((q, i) => (tags.has(i) ? { ...q, concept: tags.get(i) } : q)) };
}

async function loadTaggableItems(courseId: number) {
  const rows = await db
    .select()
    .from(generated_items)
    .where(
      and(
        eq(generated_items.course_id, courseId),
        or(eq(generated_items.mode, "flashcards"), eq(generated_items.mode, "quiz"))
      )
    );
  const items = [];
  for (const row of rows) {
    try {
      const content = JSON.parse(row.content_json) as TaggableContent;
      const untagged = untaggedEntries(row.mode, content);
      if (untagged.length) items.push({ row, content, untagged });
    } catch {
      // unreadable content can't be tagged
    }
  }
  return items;
}

export async function countUntagged(courseId: number): Promise<{ items: number; entries: number }> {
  const items = await loadTaggableItems(courseId);
  return { items: items.length, entries: items.reduce((n, i) => n + i.untagged.length, 0) };
}

export async function tagCourseConcepts(courseId: number): Promise<{ taggedItems: number; remainingItems: number }> {
  const items = await loadTaggableItems(courseId);
  if (items.length === 0) return { taggedItems: 0, remainingItems: 0 };

  const [course, plan, existing, settings] = await Promise.all([
    getCourse(courseId),
    getStudyPlanForCourse(courseId),
    listConceptsForCourse(courseId),
    getAppSettings(),
  ]);
  // Plan subtopic → its chapter, so a concept named after a subtopic links
  // to that chapter.
  const subtopicChapters = new Map<string, number>();
  for (const chapter of plan?.chapters ?? []) {
    for (const s of chapter.subtopics) {
      const name = cleanConceptName(s.text);
      if (name && !subtopicChapters.has(conceptKey(name))) subtopicChapters.set(conceptKey(name), chapter.id);
    }
  }

  let tagged = 0;
  for (const { row, content, untagged } of items.slice(0, TAG_ITEMS_PER_RUN)) {
    // The item's own chapter's subtopics first, then the rest of the plan,
    // then concepts already in use.
    const chapter = plan?.chapters.find((c) => c.id === row.study_plan_chapter_id);
    const known = [
      ...(chapter?.subtopics.map((s) => s.text) ?? []),
      ...(plan?.chapters.flatMap((c) => c.subtopics.map((s) => s.text)) ?? []),
      ...existing.map((c) => c.name),
    ]
      .map(cleanConceptName)
      .filter((n): n is string => !!n);
    const unique = [...new Map(known.map((n) => [conceptKey(n), n])).values()].slice(0, MAX_KNOWN_CONCEPTS);

    const raw = await generateStructured<unknown>({
      system: conceptTagSystemPrompt(course?.name ?? "this course", unique),
      user: conceptTagUserPrompt(untagged),
      maxTokens: 2000,
      effort: "low",
      efficient: settings.aiEfficiencyMode,
    });
    const byNumber = normalizeConceptTags(raw, untagged.length);
    if (byNumber.size === 0) continue;
    const byIndex = new Map([...byNumber].map(([n, name]) => [untagged[n - 1].index, name]));

    await updateGeneratedItemContent({
      id: row.id,
      contentJson: applyConceptTags(row.mode, content, byIndex),
      sourceDocumentIds: JSON.parse(row.source_document_ids),
    });
    const ids = await findOrCreateConcepts(courseId, [...byIndex.values()], subtopicChapters);
    const kind: ReviewItemKind = row.mode === "flashcards" ? "card" : "question";
    const conceptByIndex = new Map<number, number>();
    for (const [index, name] of byIndex) {
      const id = ids.get(conceptKey(name));
      if (id !== undefined) conceptByIndex.set(index, id);
    }
    await setConceptIds(row.id, kind, conceptByIndex);
    for (const c of await listConceptsForCourse(courseId)) {
      if (!existing.some((e) => e.id === c.id)) existing.push(c);
    }
    tagged++;
  }
  return { taggedItems: tagged, remainingItems: Math.max(0, items.length - tagged) };
}
