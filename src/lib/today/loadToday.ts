import { listCourseNames } from "../models";
import { localToday, missedSessions } from "../studyPlan/schedule";
import { reschedulePlan } from "../studyPlan/scheduleService";
import { getStudyPlan, listReadyStudyPlans, listPlanStatuses } from "../studyPlan/store";
import { chapterIsComplete, chapterIsPassed, nextChapter } from "../studyPlanDisplay";
import type { StudyPlan } from "../studyPlan/types";
import { summarizeKnowledge } from "../review/knowledgeSummary";
import { listMistakes } from "../review/mistakes";
import { loadQueueSources, loadReviewQueue } from "../review/queue";
import { ensureFsrsMigrated } from "../review/legacyMigration";
import { getExamProfile } from "../exams/store";
import { SKILL_CHECK_MINUTES } from "../exams/topicProfile";
import { loadCoursesExamInfo } from "../readiness/load";
import { buildCourseRows, lastStudiedAt, type CourseStudyRow } from "./courseOverview";
import { revisionChapter } from "./revision";
import {
  nextChapterStep,
  planDay,
  type ChapterCandidate,
  type MockExamDue,
  type TodayStep,
  type WeakConcept,
} from "./planDay";

// Gathers what the Today autopilot plans over (see planDay.ts) — across
// every course, or one.

export const DEFAULT_TODAY_MINUTES = 45;
export const MAX_DEFAULT_TODAY_MINUTES = 120;
// Most chapters one session takes on when the learner picks them.
export const MAX_PICKED_CHAPTERS = 5;

// A weak concept needs a few reviewed items before its recall means much,
// and has to actually be weak: a concept you'd recall 80%+ of right now
// doesn't need extra practice today.
const MIN_REVIEWED_FOR_WEAK = 2;
export const WEAK_RECALL = 0.8;

// Missed plan sessions are absorbed automatically: the schedule is rebuilt
// from today, so the autopilot never shows a backlog of past days (Replan
// stays available for the AI-assisted version).
// Loads of Today can overlap (a refresh, two tabs); one reschedule per plan
// at a time, or each would recreate the plan's Google Calendar events.
const rescheduling = new Map<number, Promise<StudyPlan>>();

function absorbMissedDays(plan: StudyPlan, today: string): Promise<StudyPlan> {
  if (!plan.options.schedule || missedSessions(plan.sessions, today).length === 0) return Promise.resolve(plan);
  const running = rescheduling.get(plan.id);
  if (running) return running;
  const run = (async () => {
    try {
      await reschedulePlan(plan.id);
      return (await getStudyPlan(plan.id)) ?? plan;
    } catch (err) {
      console.error(`Today: couldn't reschedule study plan ${plan.id}:`, err);
      return plan;
    } finally {
      rescheduling.delete(plan.id);
    }
  })();
  rescheduling.set(plan.id, run);
  return run;
}

// A chapter with something left to do: not finished, or finished but its
// check not passed yet.
function chapterIsOpen(chapter: StudyPlan["chapters"][number]): boolean {
  return !chapterIsComplete(chapter) || !chapterIsPassed(chapter);
}

// What the picker offers: every open chapter of the plans in scope, in
// roadmap order within each course.
export interface OpenChapter {
  planId: number;
  courseId: number;
  courseName: string;
  chapterId: number;
  chapterTitle: string;
}

export function openChapters(plans: StudyPlan[], courseNames: Map<number, string>): OpenChapter[] {
  return plans.flatMap((plan) =>
    [...plan.chapters]
      .sort((a, b) => a.stage - b.stage || a.position - b.position)
      .filter(chapterIsOpen)
      .map((c) => ({
        planId: plan.id,
        courseId: plan.course_id,
        courseName: courseNames.get(plan.course_id) ?? plan.title,
        chapterId: c.id,
        chapterTitle: c.title,
      }))
  );
}

// Scheduled plans offer today's sessions; unscheduled ones their next
// chapter. Today's sessions come first. With `only` (chapters the learner
// picked), exactly those chapters are offered instead, scheduled today or not.
export function chapterCandidates(
  plans: StudyPlan[],
  courseNames: Map<number, string>,
  today: string,
  only?: ReadonlySet<number>
): ChapterCandidate[] {
  const scheduled: ChapterCandidate[] = [];
  const open: ChapterCandidate[] = [];
  for (const plan of plans) {
    const courseName = courseNames.get(plan.course_id) ?? plan.title;
    const deadline = plan.options.deadline;
    const daysLeft = deadline ? Math.round((Date.parse(deadline) - Date.parse(today)) / 86_400_000) : null;
    const base = {
      planId: plan.id,
      courseId: plan.course_id,
      courseName,
      deadline,
      daysLeft,
      lastStudiedAt: lastStudiedAt(plan),
    };
    const candidate = (
      chapter: StudyPlan["chapters"][number],
      session: { id: number; minutes: number; kind: string } | null,
      revision = false
    ): ChapterCandidate => ({
      ...base,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      mastery: chapter.mastery,
      awaitingCheck: chapterIsComplete(chapter) && !chapterIsPassed(chapter),
      session: session ? { id: session.id, minutes: session.minutes } : null,
      ...(revision ? { revision: true } : {}),
      next: nextChapterStep(chapter, (!!session && session.kind !== "study") || chapterIsComplete(chapter), {
        pretest: plan.options.diagnostic,
        revision,
      }),
    });
    const todaysSessions = plan.options.schedule
      ? plan.sessions.filter((s) => s.date === today && !s.done_at)
      : [];
    if (only) {
      // A picked chapter that's already finished is revised rather than skipped.
      const picked = [...plan.chapters]
        .sort((a, b) => a.stage - b.stage || a.position - b.position)
        .filter((c) => only.has(c.id));
      for (const chapter of picked) {
        const session = todaysSessions.find((s) => s.chapter_id === chapter.id) ?? null;
        (session ? scheduled : open).push(candidate(chapter, session, !chapterIsOpen(chapter)));
      }
    } else if (plan.options.schedule) {
      for (const session of todaysSessions) {
        const chapter = plan.chapters.find((c) => c.id === session.chapter_id);
        if (chapter) scheduled.push(candidate(chapter, session));
      }
    } else {
      const chapter = nextChapter(plan, plan.options.practice);
      if (chapter) open.push(candidate(chapter, null));
    }
    // Nothing left to learn: bring the weakest finished chapter back, on
    // scheduled plans too (their sessions run out once every chapter is done).
    if (!only && !nextChapter(plan, plan.options.practice) && !todaysSessions.length) {
      const chapter = revisionChapter(plan);
      if (chapter) open.push(candidate(chapter, null, true));
    }
  }
  return [...scheduled, ...open];
}

export interface TodayPlan {
  minutes: number;
  steps: TodayStep[];
  date: string;
  // Every open chapter in scope, for picking what to study today.
  chapters: OpenChapter[];
  // Where each course stands, for picking any subject up: every course when
  // Today covers them all, empty when narrowed to one.
  courses: CourseStudyRow[];
}

export async function loadToday(options: {
  courseId: number | null;
  minutes?: number;
  dayStart?: string;
  // Chapters the learner picked to study today; none means the autopilot chooses.
  chapterIds?: number[];
  now?: Date;
}): Promise<TodayPlan> {
  const now = options.now ?? new Date();
  const today = localToday(now);
  const courseId = options.courseId;

  // Sources carry FSRS state, so the one-time migration has to finish first.
  await ensureFsrsMigrated();
  const sourcesLoad = loadQueueSources(courseId);
  const [queue, mistakes, allPlans, courses, sources, planStatuses] = await Promise.all([
    sourcesLoad.then((loaded) => loadReviewQueue({ courseId, dayStart: options.dayStart, now, limit: 1, sources: loaded })),
    listMistakes({ courseId, status: "open" }),
    listReadyStudyPlans(),
    listCourseNames(courseId),
    sourcesLoad,
    courseId === null ? listPlanStatuses() : Promise.resolve([]),
  ]);
  const courseNames = new Map(courses.map((c) => [c.id, c.name]));
  const plans = await Promise.all(
    allPlans.filter((p) => courseId === null || p.course_id === courseId).map((p) => absorbMissedDays(p, today))
  );
  // Exam mode per course: no new chapters in an exam's final days, a mock
  // exam when one is due, more mixed practice.
  const examInfo = await loadCoursesExamInfo(
    courses.map((c) => c.id),
    now
  );
  const profiles = new Map(
    await Promise.all(
      [...examInfo].filter(([, i]) => i.mode.mockExamDue).map(async ([id]) => [id, await getExamProfile(id)] as const)
    )
  );
  // A picked chapter is studied even in an exam's final days: it was asked for.
  const picked = options.chapterIds?.length ? new Set(options.chapterIds) : undefined;
  const chapters = chapterCandidates(plans, courseNames, today, picked).filter(
    (c) => picked || c.revision || !examInfo.get(c.courseId)?.mode.noNewMaterial
  );
  const mockExams: MockExamDue[] = [...examInfo]
    .filter(([, i]) => i.mode.mockExamDue)
    .sort(([, a], [, b]) => a.mode.daysLeft - b.mode.daysLeft)
    .map(([id, i]) => ({
      courseId: id,
      courseName: courseNames.get(id) ?? "",
      daysLeft: i.mode.daysLeft,
      minutes: profiles.get(id)?.profile.durationMinutes ?? SKILL_CHECK_MINUTES,
    }));
  const inExamMode = [...examInfo.values()].some((i) => i.mode.active);

  // The weakest concepts with enough reviews behind them, across the scope.
  const weak: WeakConcept[] = [];
  const byCourse = new Map<number, typeof sources>();
  for (const s of sources) byCourse.set(s.courseId, [...(byCourse.get(s.courseId) ?? []), s]);
  for (const [cid, courseSources] of byCourse) {
    const { concepts } = summarizeKnowledge(courseSources, {
      now,
      chapterByConcept: new Map(),
      openMistakesByConcept: new Map(),
    });
    for (const c of concepts) {
      if (c.reviewed < MIN_REVIEWED_FOR_WEAK || c.recall >= WEAK_RECALL) continue;
      weak.push({ courseId: cid, courseName: courseNames.get(cid) ?? "", name: c.name, recall: c.recall });
    }
  }

  // Default length: today's scheduled plan time, if any, else a standard session.
  const scheduledMinutes = chapters.reduce((n, c) => n + (c.session?.minutes ?? 0), 0);
  // Capped: several courses' sessions on one day shouldn't inflate it.
  const minutes = options.minutes ?? Math.max(DEFAULT_TODAY_MINUTES, Math.min(scheduledMinutes + 15, MAX_DEFAULT_TODAY_MINUTES));

  const steps = planDay({
    minutes,
    courseId,
    reviews: queue.counts,
    mistakes: { sure: mistakes.filter((m) => m.confidence === "sure").length, total: mistakes.length },
    mockExams,
    chapters,
    weakConcepts: weak.sort((a, b) => a.recall - b.recall),
    examMode: inExamMode,
    maxChapterSteps: picked ? Math.min(picked.size, MAX_PICKED_CHAPTERS) : undefined,
  });
  return {
    minutes,
    steps,
    date: today,
    chapters: openChapters(plans, courseNames),
    courses: courseId === null ? buildCourseRows({ courses, readyPlans: plans, planStatuses, now }) : [],
  };
}
