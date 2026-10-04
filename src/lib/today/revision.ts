import { chapterIsComplete, chapterIsPassed, nextChapter } from "../studyPlanDisplay";
import type { StudyPlan, StudyPlanChapter } from "../studyPlan/types";

// Revision: what Today offers for a course once its study plan has no
// chapters left to learn. The plan stays in play — the weakest finished
// chapter comes back for a test, rotating as results improve — instead of
// the course just dropping out of Today until something is due.

// When a chapter's best quiz already scored this high (0–100), repeating that
// same quiz would test memory of its answers more than the chapter, so
// revision asks for a fresh quiz instead.
export const REVISION_FRESH_QUIZ_SCORE = 85;

// When the learner last did anything in a chapter — null if never. Timestamps
// are "YYYY-MM-DD HH:MM:SS" UTC, which sort as plain strings.
export function chapterLastStudiedAt(chapter: StudyPlanChapter): string | null {
  let latest: string | null = null;
  const consider = (timestamp: string | null) => {
    if (timestamp && (latest === null || timestamp > latest)) latest = timestamp;
  };
  consider(chapter.completed_at);
  if (chapter.subtopics.some((s) => s.done)) consider(chapter.updated_at);
  for (const resource of chapter.resources) consider(resource.done_at);
  return latest;
}

// A plan is ready for revision when everything in it is learned (and, with
// practice on, passed).
export function isFullyLearned(plan: Pick<StudyPlan, "chapters" | "options">): boolean {
  return plan.chapters.length > 0 && nextChapter(plan, plan.options.practice) === null;
}

// The finished chapter most worth revisiting: lowest mastery first (a chapter
// never tested counts as the weakest, it's the one we know least about), then
// the one studied longest ago, then roadmap order.
export function revisionChapter(plan: Pick<StudyPlan, "chapters" | "options">): StudyPlanChapter | null {
  if (!isFullyLearned(plan)) return null;
  const finished = plan.chapters.filter((c) => chapterIsComplete(c) && (!plan.options.practice || chapterIsPassed(c)));
  return (
    [...finished].sort(
      (a, b) =>
        (a.mastery ?? -1) - (b.mastery ?? -1) ||
        (chapterLastStudiedAt(a) ?? "").localeCompare(chapterLastStudiedAt(b) ?? "") ||
        a.stage - b.stage ||
        a.position - b.position
    )[0] ?? null
  );
}
