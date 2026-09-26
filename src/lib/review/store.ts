import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { Grade } from "ts-fsrs";
import { db, generated_items, mistakes, review_items, review_logs, runTransaction } from "../db";
import { scheduleReview, type MemoryState } from "../fsrs";
import type { Confidence, ReviewItemKind, ReviewSource } from "./types";

// FSRS state per card/question (review_items) and the log of every graded
// answer (review_logs). A card or question with no review_items row has
// never been reviewed: it counts as new (and, for cards, due) — rows are
// only created on the first graded answer.

export type ReviewItemRow = typeof review_items.$inferSelect;
export type ReviewLogRow = typeof review_logs.$inferSelect;

export async function getReviewItem(
  generatedItemId: number,
  kind: ReviewItemKind,
  itemIndex: number
): Promise<ReviewItemRow | undefined> {
  const rows = await db
    .select()
    .from(review_items)
    .where(
      and(
        eq(review_items.generated_item_id, generatedItemId),
        eq(review_items.kind, kind),
        eq(review_items.item_index, itemIndex)
      )
    )
    .limit(1);
  return rows[0];
}

export async function listReviewItemsForItem(generatedItemId: number, kind?: ReviewItemKind): Promise<ReviewItemRow[]> {
  return db
    .select()
    .from(review_items)
    .where(
      kind
        ? and(eq(review_items.generated_item_id, generatedItemId), eq(review_items.kind, kind))
        : eq(review_items.generated_item_id, generatedItemId)
    );
}

export async function listReviewItemsForItems(generatedItemIds: number[]): Promise<ReviewItemRow[]> {
  if (generatedItemIds.length === 0) return [];
  return db.select().from(review_items).where(inArray(review_items.generated_item_id, generatedItemIds));
}

// The shape deckDueCardIndices takes: one entry per reviewed card.
export async function cardDueRowsForItem(generatedItemId: number): Promise<{ card_index: number; due_at: string }[]> {
  const rows = await listReviewItemsForItem(generatedItemId, "card");
  return rows.map((r) => ({ card_index: r.item_index, due_at: r.due_at }));
}

// Every reviewed card's due date, for the cross-course due counts.
export async function listAllCardDueRows(): Promise<{ generated_item_id: number; card_index: number; due_at: string }[]> {
  return db
    .select({
      generated_item_id: review_items.generated_item_id,
      card_index: review_items.item_index,
      due_at: review_items.due_at,
    })
    .from(review_items)
    .where(eq(review_items.kind, "card"));
}

function memoryOf(row: ReviewItemRow): MemoryState {
  return {
    due_at: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    scheduled_days: row.scheduled_days,
    last_reviewed_at: row.last_reviewed_at,
  };
}

export interface RecordReviewInput {
  generatedItemId: number;
  kind: ReviewItemKind;
  itemIndex: number;
  rating: Grade;
  correct: boolean;
  confidence: Confidence | null;
  source: ReviewSource;
  conceptId?: number | null;
  retention?: number;
  now?: Date;
}

// Grades one answer: moves the item's FSRS state on and logs the review.
// Returns the updated row.
export async function recordReview(input: RecordReviewInput): Promise<ReviewItemRow> {
  const now = input.now ?? new Date();
  const existing = await getReviewItem(input.generatedItemId, input.kind, input.itemIndex);
  const { memory, log } = scheduleReview(existing ? memoryOf(existing) : null, input.rating, now, {
    retention: input.retention,
  });
  const reviewedAt = memory.last_reviewed_at as string;

  return runTransaction(async (tx) => {
    let row: ReviewItemRow;
    if (existing) {
      const conceptId = input.conceptId === undefined ? existing.concept_id : input.conceptId;
      [row] = await tx
        .update(review_items)
        .set({ ...memory, concept_id: conceptId })
        .where(eq(review_items.id, existing.id))
        .returning();
    } else {
      [row] = await tx
        .insert(review_items)
        .values({
          generated_item_id: input.generatedItemId,
          kind: input.kind,
          item_index: input.itemIndex,
          concept_id: input.conceptId ?? null,
          ...memory,
          created_at: reviewedAt,
        })
        .returning();
    }
    await tx.insert(review_logs).values({
      review_item_id: row.id,
      rating: log.rating,
      confidence: input.confidence,
      source: input.source,
      correct: input.correct,
      reviewed_at: reviewedAt,
      stability: log.stability,
      difficulty: log.difficulty,
      scheduled_days: log.scheduled_days,
    });
    return row;
  });
}

// review_items and mistakes are keyed by position in the item's content
// (like flashcard_schedule was), so removing cards/questions shifts every
// later one down. Rows for removed positions are deleted; the rest move to
// their new index. Walking ascending never collides with the unique
// (item, kind, index) key: each target index is lower than the source and
// has already been vacated.
export async function reconcileReviewItemsAfterRemoval(
  generatedItemId: number,
  kind: ReviewItemKind,
  removedIndices: number[]
): Promise<void> {
  const removed = [...new Set(removedIndices)].sort((a, b) => a - b);
  if (removed.length === 0) return;
  const shiftFor = (index: number) => removed.filter((i) => i < index).length;

  const [items, mistakeRows] = await Promise.all([
    db
      .select({ id: review_items.id, item_index: review_items.item_index })
      .from(review_items)
      .where(and(eq(review_items.generated_item_id, generatedItemId), eq(review_items.kind, kind)))
      .orderBy(asc(review_items.item_index)),
    db
      .select({ id: mistakes.id, item_index: mistakes.item_index })
      .from(mistakes)
      .where(and(eq(mistakes.generated_item_id, generatedItemId), eq(mistakes.kind, kind))),
  ]);

  await runTransaction(async (tx) => {
    for (const row of items) {
      if (removed.includes(row.item_index)) {
        await tx.delete(review_items).where(eq(review_items.id, row.id));
      }
    }
    for (const row of items) {
      if (removed.includes(row.item_index)) continue;
      const shift = shiftFor(row.item_index);
      if (shift > 0) {
        await tx
          .update(review_items)
          .set({ item_index: row.item_index - shift })
          .where(eq(review_items.id, row.id));
      }
    }
    for (const row of mistakeRows) {
      if (removed.includes(row.item_index)) {
        await tx.delete(mistakes).where(eq(mistakes.id, row.id));
        continue;
      }
      const shift = shiftFor(row.item_index);
      if (shift > 0) {
        await tx.update(mistakes).set({ item_index: row.item_index - shift }).where(eq(mistakes.id, row.id));
      }
    }
  });
}

// Review logs since `since` (UTC text), with the item they belong to.
export async function listReviewLogsSince(since: string) {
  return db
    .select({
      review_item_id: review_logs.review_item_id,
      reviewed_at: review_logs.reviewed_at,
      rating: review_logs.rating,
      correct: review_logs.correct,
      confidence: review_logs.confidence,
      source: review_logs.source,
      kind: review_items.kind,
      generated_item_id: review_items.generated_item_id,
      course_id: generated_items.course_id,
    })
    .from(review_logs)
    .innerJoin(review_items, eq(review_items.id, review_logs.review_item_id))
    .innerJoin(generated_items, eq(generated_items.id, review_items.generated_item_id))
    .where(gte(review_logs.reviewed_at, since));
}

// How many cards got their first-ever review at or after `since` — the
// part of today's new-card allowance already used.
export async function countNewCardsIntroducedSince(since: string): Promise<number> {
  const rows = await db
    .select({ id: review_items.id })
    .from(review_items)
    .where(and(eq(review_items.kind, "card"), gte(review_items.created_at, since)));
  return rows.length;
}

export function startOfUtcDay(now = new Date()): string {
  return `${now.toISOString().slice(0, 10)} 00:00:00`;
}

// Points the review state and mistakes of the given cards/questions at
// their (new) concepts — after tagging.
export async function setConceptIds(
  generatedItemId: number,
  kind: ReviewItemKind,
  conceptByIndex: Map<number, number>
): Promise<void> {
  for (const [index, conceptId] of conceptByIndex) {
    await db
      .update(review_items)
      .set({ concept_id: conceptId })
      .where(
        and(
          eq(review_items.generated_item_id, generatedItemId),
          eq(review_items.kind, kind),
          eq(review_items.item_index, index)
        )
      );
    await db
      .update(mistakes)
      .set({ concept_id: conceptId })
      .where(
        and(eq(mistakes.generated_item_id, generatedItemId), eq(mistakes.kind, kind), eq(mistakes.item_index, index))
      );
  }
}
