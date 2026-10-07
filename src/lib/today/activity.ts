import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  flashcard_reviews,
  generated_items,
  quiz_attempts,
  review_items,
  review_logs,
  study_plan_chapters,
  study_plan_resources,
  study_plans,
} from "../db";
import { localDayOfUtc, toUtcText } from "../time";

// The days (local, "YYYY-MM-DD") on which the learner did anything in each
// course lately — for a plan's Today frequency (cadence.ts). "Anything" is
// whatever leaves a dated record: a card or question reviewed, a quiz taken,
// a plan resource finished, a chapter completed. A code exercise counts
// through the review it adds. Only the last `days` days are looked at.
export async function activeDaysByCourse(courseIds: number[], now: Date, days = 8): Promise<Map<number, Set<string>>> {
  const result = new Map<number, Set<string>>(courseIds.map((id) => [id, new Set<string>()]));
  if (courseIds.length === 0) return result;
  const since = new Date(now);
  since.setDate(since.getDate() - days);
  // A little earlier than the local day boundary, so no activity near it is missed.
  const cutoff = toUtcText(new Date(since.getTime() - 86_400_000));
  const add = (courseId: number, timestamp: string | null) => {
    if (timestamp) result.get(courseId)?.add(localDayOfUtc(timestamp));
  };

  const [attempts, logs, cards, resources, chapters] = await Promise.all([
    db
      .select({ course: generated_items.course_id, at: quiz_attempts.completed_at })
      .from(quiz_attempts)
      .innerJoin(generated_items, eq(generated_items.id, quiz_attempts.generated_item_id))
      .where(and(inArray(generated_items.course_id, courseIds), isNotNull(quiz_attempts.completed_at), gte(quiz_attempts.completed_at, cutoff))),
    db
      .select({ course: generated_items.course_id, at: review_logs.reviewed_at })
      .from(review_logs)
      .innerJoin(review_items, eq(review_items.id, review_logs.review_item_id))
      .innerJoin(generated_items, eq(generated_items.id, review_items.generated_item_id))
      .where(and(inArray(generated_items.course_id, courseIds), gte(review_logs.reviewed_at, cutoff))),
    db
      .select({ course: generated_items.course_id, at: flashcard_reviews.reviewed_at })
      .from(flashcard_reviews)
      .innerJoin(generated_items, eq(generated_items.id, flashcard_reviews.generated_item_id))
      .where(and(inArray(generated_items.course_id, courseIds), gte(flashcard_reviews.reviewed_at, cutoff))),
    db
      .select({ course: study_plans.course_id, at: study_plan_resources.done_at })
      .from(study_plan_resources)
      .innerJoin(study_plan_chapters, eq(study_plan_chapters.id, study_plan_resources.chapter_id))
      .innerJoin(study_plans, eq(study_plans.id, study_plan_chapters.plan_id))
      .where(and(inArray(study_plans.course_id, courseIds), isNotNull(study_plan_resources.done_at), gte(study_plan_resources.done_at, cutoff))),
    db
      .select({ course: study_plans.course_id, at: study_plan_chapters.completed_at })
      .from(study_plan_chapters)
      .innerJoin(study_plans, eq(study_plans.id, study_plan_chapters.plan_id))
      .where(and(inArray(study_plans.course_id, courseIds), isNotNull(study_plan_chapters.completed_at), gte(study_plan_chapters.completed_at, cutoff))),
  ]);
  for (const row of [...attempts, ...logs, ...cards, ...resources, ...chapters]) add(row.course, row.at);
  return result;
}
