import { and, eq, or } from "drizzle-orm";
import { courses, db, generated_items } from "../db";
import { getAppSettings } from "../models";
import type { FlashcardsContent, QuizContent } from "../types";
import { ensureFsrsMigrated } from "./legacyMigration";
import { countNewCardsIntroducedSince, listReviewItemsForItems, startOfUtcDay, type ReviewItemRow } from "./store";
import { buildFocusQueue, buildQueue, conceptKeys, mistakesToRedo, type QueueSource } from "./queueBuild";
import { listMistakes } from "./mistakes";
import { conceptKey } from "../conceptName";
import { itemContents } from "../itemContentCache";

// Loads the review queue (see queueBuild.ts for how it's assembled).

// A queue source with each review's full FSRS state.
export type LoadedSource = QueueSource & { reviews: ReviewItemRow[] };

export async function loadQueueSources(courseId: number | null): Promise<LoadedSource[]> {
  const modes = or(eq(generated_items.mode, "flashcards"), eq(generated_items.mode, "quiz"));
  const rows = await db
    .select({
      id: generated_items.id,
      title: generated_items.title,
      mode: generated_items.mode,
      updated_at: generated_items.updated_at,
      course_id: generated_items.course_id,
      course_name: courses.name,
    })
    .from(generated_items)
    .innerJoin(courses, eq(courses.id, generated_items.course_id))
    .where(courseId === null ? modes : and(modes, eq(generated_items.course_id, courseId)));
  // Content from memory where it hasn't changed — see itemContentCache.ts.
  const [reviews, contents] = await Promise.all([listReviewItemsForItems(rows.map((r) => r.id)), itemContents(rows)]);
  const byItem = new Map<number, ReviewItemRow[]>();
  for (const r of reviews) {
    const list = byItem.get(r.generated_item_id);
    if (list) list.push(r);
    else byItem.set(r.generated_item_id, [r]);
  }

  const sources: LoadedSource[] = [];
  for (const row of rows) {
    let content: FlashcardsContent | QuizContent;
    try {
      content = JSON.parse(contents.get(row.id) ?? "");
    } catch {
      continue; // one unreadable item mustn't break the whole queue
    }
    sources.push({
      itemId: row.id,
      itemTitle: row.title,
      courseId: row.course_id,
      courseName: row.course_name,
      mode: row.mode as "flashcards" | "quiz",
      content,
      reviews: byItem.get(row.id) ?? [],
    });
  }
  return sources;
}

export const DEFAULT_QUEUE_LIMIT = 100;

// `dayStart` is the start of the learner's own day (UTC text), so "new
// cards per day" follows their midnight; defaults to UTC midnight.
export async function loadReviewQueue(options: {
  courseId?: number | null;
  now?: Date;
  dayStart?: string;
  limit?: number;
  // Already-loaded sources for the same course scope, to skip loading them again.
  sources?: LoadedSource[];
}) {
  const now = options.now ?? new Date();
  await ensureFsrsMigrated();
  const [{ newCardsPerDay }, sources, introduced] = await Promise.all([
    getAppSettings(),
    options.sources ?? loadQueueSources(options.courseId ?? null),
    countNewCardsIntroducedSince(options.dayStart ?? startOfUtcDay(now)),
  ]);
  return buildQueue(sources, {
    now,
    newCardAllowance: newCardsPerDay - introduced,
    limit: options.limit ?? DEFAULT_QUEUE_LIMIT,
  });
}

export type QueueMode = "due" | "mistakes" | "concept";

// A focused session: open mistakes (the ones you were sure about first), or
// every item of one concept. Answers are scheduled like any other review.
export async function loadFocusQueue(options: {
  mode: "mistakes" | "concept";
  courseId?: number | null;
  concept?: string;
  limit?: number;
  // The start of the learner's day (UTC text): mistakes answered since then are left for another day.
  dayStart?: string;
  now?: Date;
}) {
  await ensureFsrsMigrated();
  const courseId = options.courseId ?? null;
  const limit = options.limit ?? DEFAULT_QUEUE_LIMIT;
  const sources = await loadQueueSources(courseId);
  let keys: string[];
  if (options.mode === "mistakes") {
    const open = mistakesToRedo(
      await listMistakes({ courseId, status: "open" }),
      sources.flatMap((s) => s.reviews),
      options.dayStart ?? startOfUtcDay(options.now ?? new Date())
    );
    const rank = (c: string | null) => (c === "sure" ? 0 : c === "unsure" ? 1 : 2);
    keys = [...open]
      .sort((a, b) => rank(a.confidence) - rank(b.confidence))
      .map((m) => `${m.generated_item_id}:${m.kind}:${m.item_index}`);
  } else {
    keys = conceptKeys(sources, conceptKey(options.concept ?? ""));
  }
  const entries = buildFocusQueue(sources, keys, limit);
  return { entries, counts: { dueCards: 0, dueQuestions: 0, newCards: 0 } };
}
