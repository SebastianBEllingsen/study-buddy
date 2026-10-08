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
  study_plan_sessions,
  study_plans,
} from "../db";
import { localDayOfUtc, toUtcText } from "../time";

// The days (local, "YYYY-MM-DD") on which the learner worked on each course's
// study plan lately — for a plan's Today frequency (cadence.ts). Plan work is
// whatever leaves a dated record against the plan: a plan resource finished,
// a chapter completed, a plan session finished (Today records "done for
// today" on a big resource as one), a subtopic ticked, and the quizzes,
// flashcards and code exercises made for a chapter. Reviewing the course's
// other cards doesn't count: the reviews step always comes first in Today,
// and would otherwise mark a plan as done before its chapter step. Only the
// last `days` days are looked at.
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

  const [attempts, logs, cards, resources, chapters, sessions, touched] = await Promise.all([
    db
      .select({ course: generated_items.course_id, at: quiz_attempts.completed_at })
      .from(quiz_attempts)
      .innerJoin(generated_items, eq(generated_items.id, quiz_attempts.generated_item_id))
      .where(and(inArray(generated_items.course_id, courseIds), isNotNull(generated_items.study_plan_chapter_id), isNotNull(quiz_attempts.completed_at), gte(quiz_attempts.completed_at, cutoff))),
    db
      .select({ course: generated_items.course_id, at: review_logs.reviewed_at })
      .from(review_logs)
      .innerJoin(review_items, eq(review_items.id, review_logs.review_item_id))
      .innerJoin(generated_items, eq(generated_items.id, review_items.generated_item_id))
      .where(and(inArray(generated_items.course_id, courseIds), isNotNull(generated_items.study_plan_chapter_id), gte(review_logs.reviewed_at, cutoff))),
    db
      .select({ course: generated_items.course_id, at: flashcard_reviews.reviewed_at })
      .from(flashcard_reviews)
      .innerJoin(generated_items, eq(generated_items.id, flashcard_reviews.generated_item_id))
      .where(and(inArray(generated_items.course_id, courseIds), isNotNull(generated_items.study_plan_chapter_id), gte(flashcard_reviews.reviewed_at, cutoff))),
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
    db
      .select({ course: study_plans.course_id, at: study_plan_sessions.done_at })
      .from(study_plan_sessions)
      .innerJoin(study_plans, eq(study_plans.id, study_plan_sessions.plan_id))
      .where(and(inArray(study_plans.course_id, courseIds), isNotNull(study_plan_sessions.done_at), gte(study_plan_sessions.done_at, cutoff))),
    // Ticking a subtopic leaves no date of its own, only the chapter's.
    db
      .select({ course: study_plans.course_id, at: study_plan_chapters.updated_at, subtopics: study_plan_chapters.subtopics_json })
      .from(study_plan_chapters)
      .innerJoin(study_plans, eq(study_plans.id, study_plan_chapters.plan_id))
      .where(and(inArray(study_plans.course_id, courseIds), gte(study_plan_chapters.updated_at, cutoff))),
  ]);
  for (const row of [...attempts, ...logs, ...cards, ...resources, ...chapters, ...sessions]) add(row.course, row.at);
  for (const row of touched) if (/"done"\s*:\s*true/.test(row.subtopics)) add(row.course, row.at);
  return result;
}
