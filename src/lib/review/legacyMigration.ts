import { and, asc, eq, isNull } from "drizzle-orm";
import { app_settings, db, flashcard_reviews, generated_items, review_items, review_logs, runTransaction } from "../db";
import { fromUtcText, ratingFromFlashcardResult, scheduleReview, type MemoryState, type ReviewOutcome } from "../fsrs";
import type { FlashcardResult } from "../models";
import type { FlashcardsContent } from "../types";
import { nowUtc } from "../time";

// One-time move from the old SM-2 flashcard schedule to FSRS: every card's
// flashcard_reviews history is replayed through FSRS in order, which gives
// the same memory state it would have had if FSRS had scheduled it all
// along. Cards that already have FSRS state are left alone, so a rerun (or a
// race between two requests) never double-counts. flashcard_schedule itself
// is no longer read after this.

export async function migrateLegacyFlashcardHistory(): Promise<{ cards: number; reviews: number }> {
  const [reviews, items, existing] = await Promise.all([
    db
      .select()
      .from(flashcard_reviews)
      .orderBy(asc(flashcard_reviews.generated_item_id), asc(flashcard_reviews.card_index), asc(flashcard_reviews.reviewed_at)),
    db
      .select({ id: generated_items.id, content_json: generated_items.content_json })
      .from(generated_items)
      .where(eq(generated_items.mode, "flashcards")),
    db
      .select({ generated_item_id: review_items.generated_item_id, item_index: review_items.item_index })
      .from(review_items)
      .where(eq(review_items.kind, "card")),
  ]);

  const cardCounts = new Map<number, number>();
  for (const item of items) {
    try {
      cardCounts.set(item.id, (JSON.parse(item.content_json) as FlashcardsContent).cards.length);
    } catch {
      // unreadable content: its history can't be matched to cards
    }
  }
  const done = new Set(existing.map((r) => `${r.generated_item_id}:${r.item_index}`));

  const groups = new Map<string, (typeof reviews)[number][]>();
  for (const review of reviews) {
    const key = `${review.generated_item_id}:${review.card_index}`;
    if (done.has(key)) continue;
    if (review.card_index >= (cardCounts.get(review.generated_item_id) ?? 0)) continue;
    const list = groups.get(key) ?? [];
    list.push(review);
    groups.set(key, list);
  }

  let migratedReviews = 0;
  for (const history of groups.values()) {
    let memory: MemoryState | null = null;
    const logs: (ReviewOutcome["log"] & { reviewed_at: string; correct: boolean })[] = [];
    for (const review of history) {
      const outcome = scheduleReview(memory, ratingFromFlashcardResult(review.last_result as FlashcardResult), fromUtcText(review.reviewed_at), {
        fuzz: false,
      });
      memory = outcome.memory;
      logs.push({ ...outcome.log, reviewed_at: review.reviewed_at, correct: review.last_result !== "again" });
    }
    const first = history[0];
    await runTransaction(async (tx) => {
      const [row] = await tx
        .insert(review_items)
        .values({
          generated_item_id: first.generated_item_id,
          kind: "card",
          item_index: first.card_index,
          ...(memory as MemoryState),
          created_at: first.reviewed_at,
        })
        .returning({ id: review_items.id });
      await tx.insert(review_logs).values(
        logs.map((log) => ({
          review_item_id: row.id,
          rating: log.rating,
          confidence: null,
          source: "legacy" as const,
          correct: log.correct,
          reviewed_at: log.reviewed_at,
          stability: log.stability,
          difficulty: log.difficulty,
          scheduled_days: log.scheduled_days,
        }))
      );
    });
    migratedReviews += history.length;
  }
  return { cards: groups.size, reviews: migratedReviews };
}

let pending: Promise<void> | null = null;

// Runs the migration once per database: the app_settings flag makes it a
// single cheap read on every later call. Anything that reads or writes card
// review state awaits this first.
export function ensureFsrsMigrated(): Promise<void> {
  pending ??= (async () => {
    const [settings] = await db.select({ migratedAt: app_settings.fsrs_migrated_at }).from(app_settings).limit(1);
    if (settings?.migratedAt) return;
    await migrateLegacyFlashcardHistory();
    await db
      .update(app_settings)
      .set({ fsrs_migrated_at: nowUtc() })
      .where(and(eq(app_settings.id, 1), isNull(app_settings.fsrs_migrated_at)));
  })().catch((err) => {
    // Let the next call try again rather than caching the failure.
    pending = null;
    throw err;
  });
  return pending;
}

// Tests reset the module-level memo between databases.
export function resetFsrsMigrationMemo(): void {
  pending = null;
}
