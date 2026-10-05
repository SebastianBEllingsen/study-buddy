import { nextChapter, planProgress, buildIsStuck } from "../studyPlanDisplay";
import type { StudyPlan, StudyPlanStatus } from "../studyPlan/types";
import { nextChapterStep, type ChapterNextStep } from "./planDay";
import { chapterLastStudiedAt, revisionChapter } from "./revision";
import { chapterIsComplete } from "../studyPlanDisplay";

// The Today card's "Your courses" panel: one row per course that has a study
// plan (courses without one aren't listed), saying where its plan stands and what studying it next means, so any subject can be
// picked up without a schedule. Pure and client-safe; loadToday.ts gathers
// the inputs.

// When the learner last did something in a plan (ticked a subtopic, finished
// a resource, completed a chapter, finished a session) — null for a plan
// they haven't touched. Untouched plans must not look recently studied just
// because they were created recently, so creation timestamps don't count.
// Timestamps are "YYYY-MM-DD HH:MM:SS" UTC, which sort as plain strings.
export function lastStudiedAt(plan: Pick<StudyPlan, "chapters" | "sessions">): string | null {
  let latest: string | null = null;
  const consider = (timestamp: string | null) => {
    if (timestamp && (latest === null || timestamp > latest)) latest = timestamp;
  };
  for (const chapter of plan.chapters) consider(chapterLastStudiedAt(chapter));
  for (const session of plan.sessions) consider(session.done_at);
  return latest;
}

export type CourseRowState =
  | "ready" // a plan with a next chapter to study
  | "done" // every chapter finished and passed: "next" is the chapter to revise
  | "setup" // plan waiting on "what do you already know?"
  | "building" // plan still being built
  | "failed"; // plan build failed or stalled — retry from the plan page

export interface CourseStudyRow {
  courseId: number;
  courseName: string;
  planId: number;
  state: CourseRowState;
  // 0–100; null while the plan isn't usable yet.
  progressPercent: number | null;
  next: { chapterId: number; chapterTitle: string; step: string } | null;
  lastStudiedAt: string | null;
}

// A short line for what studying the chapter next means.
export function describeNextStep(next: ChapterNextStep): string {
  if (next.type === "resource") return next.title;
  if (next.type === "subtopic") return next.text;
  return next.pretest ? "Take the pre-test" : "Test yourself";
}

export interface PlanStatusRow {
  id: number;
  course_id: number;
  status: StudyPlanStatus;
  updated_at: string;
}

export function buildCourseRows(input: {
  courses: { id: number; name: string }[];
  readyPlans: StudyPlan[];
  // Every plan's status row, so unfinished plans can be told apart from
  // courses with no plan at all.
  planStatuses: PlanStatusRow[];
  now?: Date;
}): CourseStudyRow[] {
  const ready = new Map(input.readyPlans.map((p) => [p.course_id, p]));
  const statuses = new Map(input.planStatuses.map((p) => [p.course_id, p]));

  return input.courses.flatMap((course): CourseStudyRow[] => {
    const base = { courseId: course.id, courseName: course.name };
    const plan = ready.get(course.id);
    if (plan) {
      const learning = nextChapter(plan, plan.options.practice);
      // Nothing left to learn: the next thing is revising the weakest chapter.
      const chapter = learning ?? revisionChapter(plan);
      return [
        {
          ...base,
          planId: plan.id,
          state: learning ? "ready" : "done",
          progressPercent: Math.round(planProgress(plan).fraction * 100),
          next: chapter
            ? {
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                step: describeNextStep(
                  nextChapterStep(chapter, chapterIsComplete(chapter), {
                    pretest: plan.options.diagnostic,
                    revision: !learning,
                  }),
                ),
              }
            : null,
          lastStudiedAt: lastStudiedAt(plan),
        },
      ];
    }
    const other = statuses.get(course.id);
    if (!other) return [];
    const state: CourseRowState =
      other.status === "draft_topics"
        ? "setup"
        : other.status === "generating" && !buildIsStuck(other, input.now)
          ? "building"
          : "failed";
    return [
      {
        ...base,
        planId: other.id,
        state,
        progressPercent: null,
        next: null,
        lastStudiedAt: null,
      },
    ];
  });
}
