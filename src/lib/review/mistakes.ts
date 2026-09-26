import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { concepts, courses, db, generated_items, mistakes, review_logs } from "../db";
import { nowUtc } from "../time";
import type { Confidence, ReviewItemKind } from "./types";

// The mistake log: every quiz question answered wrong and every card rated
// "Again", with what was answered and — once "Explain my mistakes" has run —
// a short note on the misconception behind it. A mistake resolves itself
// once the same card/question is recalled correctly on RESOLVE_AFTER_DAYS
// separate later days (successive relearning), or when dismissed by hand.

export const RESOLVE_AFTER_DAYS = 2;

export type MistakeRow = typeof mistakes.$inferSelect;

export interface NewMistake {
  generatedItemId: number;
  reviewItemId: number | null;
  conceptId: number | null;
  kind: ReviewItemKind;
  itemIndex: number;
  prompt: string;
  givenAnswer: string | null;
  correctAnswer: string;
  confidence: Confidence | null;
}

// Records a miss. Missing the same card/question again while its mistake
// is still open updates that entry (latest answer, fresh misconception
// note) instead of piling up duplicates.
export async function logMistake(input: NewMistake): Promise<MistakeRow> {
  const [open] = await db
    .select()
    .from(mistakes)
    .where(
      and(
        eq(mistakes.generated_item_id, input.generatedItemId),
        eq(mistakes.kind, input.kind),
        eq(mistakes.item_index, input.itemIndex),
        isNull(mistakes.resolved_at)
      )
    )
    .limit(1);
  const fields = {
    review_item_id: input.reviewItemId,
    concept_id: input.conceptId,
    prompt: input.prompt,
    given_answer: input.givenAnswer,
    correct_answer: input.correctAnswer,
    confidence: input.confidence,
  };
  if (open) {
    const [row] = await db
      .update(mistakes)
      .set({ ...fields, misconception: open.given_answer === input.givenAnswer ? open.misconception : null })
      .where(eq(mistakes.id, open.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(mistakes)
    .values({
      generated_item_id: input.generatedItemId,
      kind: input.kind,
      item_index: input.itemIndex,
      ...fields,
      created_at: nowUtc(),
    })
    .returning();
  return row;
}

// Pure: whether a review history (oldest first) shows the item recalled
// correctly on enough separate days after its most recent miss.
export function recoveredSinceLastMiss(logs: { reviewed_at: string; correct: boolean }[]): boolean {
  let lastMiss = -1;
  logs.forEach((log, i) => {
    if (!log.correct) lastMiss = i;
  });
  if (lastMiss === -1) return false;
  const missDay = logs[lastMiss].reviewed_at.slice(0, 10);
  const days = new Set(
    logs
      .slice(lastMiss + 1)
      .filter((l) => l.correct)
      .map((l) => l.reviewed_at.slice(0, 10))
      .filter((d) => d !== missDay)
  );
  return days.size >= RESOLVE_AFTER_DAYS;
}

// Called after a correct review of a card/question: closes its open
// mistakes once it has been recovered.
export async function autoResolveMistakes(reviewItemId: number): Promise<number> {
  const open = await db
    .select({ id: mistakes.id })
    .from(mistakes)
    .where(and(eq(mistakes.review_item_id, reviewItemId), isNull(mistakes.resolved_at)));
  if (open.length === 0) return 0;
  const logs = await db
    .select({ reviewed_at: review_logs.reviewed_at, correct: review_logs.correct })
    .from(review_logs)
    .where(eq(review_logs.review_item_id, reviewItemId))
    .orderBy(asc(review_logs.reviewed_at), asc(review_logs.id));
  if (!recoveredSinceLastMiss(logs)) return 0;
  await db
    .update(mistakes)
    .set({ resolved_at: nowUtc() })
    .where(inArray(mistakes.id, open.map((m) => m.id)));
  return open.length;
}

export interface MistakeListEntry extends MistakeRow {
  course_id: number;
  course_name: string;
  item_title: string;
  item_mode: string;
  concept_name: string | null;
}

export type MistakeStatus = "open" | "resolved" | "all";

export async function listMistakes(filter: { courseId?: number | null; status?: MistakeStatus } = {}): Promise<MistakeListEntry[]> {
  const status = filter.status ?? "open";
  const conditions = [];
  if (filter.courseId != null) conditions.push(eq(generated_items.course_id, filter.courseId));
  if (status === "open") conditions.push(isNull(mistakes.resolved_at));
  if (status === "resolved") conditions.push(isNotNull(mistakes.resolved_at));
  const rows = await db
    .select({
      mistake: mistakes,
      course_id: generated_items.course_id,
      course_name: courses.name,
      item_title: generated_items.title,
      item_mode: generated_items.mode,
      concept_name: concepts.name,
    })
    .from(mistakes)
    .innerJoin(generated_items, eq(generated_items.id, mistakes.generated_item_id))
    .innerJoin(courses, eq(courses.id, generated_items.course_id))
    .leftJoin(concepts, eq(concepts.id, mistakes.concept_id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(mistakes.created_at), desc(mistakes.id));
  return rows.map((r) => ({
    ...r.mistake,
    course_id: r.course_id,
    course_name: r.course_name,
    item_title: r.item_title,
    item_mode: r.item_mode,
    concept_name: r.concept_name,
  }));
}

export async function getMistake(id: number): Promise<MistakeRow | undefined> {
  const [row] = await db.select().from(mistakes).where(eq(mistakes.id, id)).limit(1);
  return row;
}

export async function setMistakeResolved(id: number, resolved: boolean): Promise<void> {
  await db
    .update(mistakes)
    .set({ resolved_at: resolved ? nowUtc() : null })
    .where(eq(mistakes.id, id));
}

export async function setMisconceptions(labels: Map<number, string>): Promise<void> {
  for (const [id, misconception] of labels) {
    await db.update(mistakes).set({ misconception }).where(eq(mistakes.id, id));
  }
}
