import { getCourse, listCourses } from "../models";
import { localToday, missedSessions } from "../studyPlan/schedule";
import { reschedulePlan } from "../studyPlan/scheduleService";
import { getStudyPlan, listReadyStudyPlans } from "../studyPlan/store";
import { nextChapter } from "../studyPlanDisplay";
import type { StudyPlan } from "../studyPlan/types";
import { summarizeKnowledge } from "../review/knowledgeSummary";
import { listMistakes } from "../review/mistakes";
import { loadQueueSources, loadReviewQueue } from "../review/queue";
import { getExamProfile } from "../exams/store";
import { SKILL_CHECK_MINUTES } from "../exams/topicProfile";
import { loadCourseExamInfo } from "../readiness/load";
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

// A weak concept needs a few reviewed items before its recall means much,
// and has to actually be weak: a concept you'd recall 80%+ of right now
// doesn't need extra practice today.
const MIN_REVIEWED_FOR_WEAK = 2;
export const WEAK_RECALL = 0.8;

// Missed plan sessions are absorbed automatically: the schedule is rebuilt
// from today, so the autopilot never shows a backlog of past days (Replan
// stays available for the AI-assisted version).
async function absorbMissedDays(plan: StudyPlan, today: string): Promise<StudyPlan> {
  if (!plan.options.schedule || missedSessions(plan.sessions, today).length === 0) return plan;
  try {
    await reschedulePlan(plan.id);
    return (await getStudyPlan(plan.id)) ?? plan;
  } catch (err) {
    console.error(`Today: couldn't reschedule study plan ${plan.id}:`, err);
    return plan;
  }
}

// Scheduled plans offer today's sessions; unscheduled ones their next
// chapter. Today's sessions come first.
export function chapterCandidates(plans: StudyPlan[], courseNames: Map<number, string>, today: string): ChapterCandidate[] {
  const scheduled: ChapterCandidate[] = [];
  const open: ChapterCandidate[] = [];
  for (const plan of plans) {
    const courseName = courseNames.get(plan.course_id) ?? plan.title;
    const base = { planId: plan.id, courseId: plan.course_id, courseName };
    if (plan.options.schedule) {
      for (const session of plan.sessions.filter((s) => s.date === today && !s.done_at)) {
        const chapter = plan.chapters.find((c) => c.id === session.chapter_id);
        if (!chapter) continue;
        scheduled.push({
          ...base,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          session: { id: session.id, minutes: session.minutes },
          next: nextChapterStep(chapter, session.kind === "review"),
        });
      }
    } else {
      const chapter = nextChapter(plan);
      if (chapter) {
        open.push({ ...base, chapterId: chapter.id, chapterTitle: chapter.title, session: null, next: nextChapterStep(chapter) });
      }
    }
  }
  return [...scheduled, ...open];
}

export interface TodayPlan {
  minutes: number;
  steps: TodayStep[];
  date: string;
}

export async function loadToday(options: {
  courseId: number | null;
  minutes?: number;
  dayStart?: string;
  now?: Date;
}): Promise<TodayPlan> {
  const now = options.now ?? new Date();
  const today = localToday(now);
  const courseId = options.courseId;

  const [queue, mistakes, allPlans, courses, sources] = await Promise.all([
    loadReviewQueue({ courseId, dayStart: options.dayStart, now, limit: 1 }),
    listMistakes({ courseId, status: "open" }),
    listReadyStudyPlans(),
    courseId === null ? listCourses() : getCourse(courseId).then((c) => (c ? [c] : [])),
    loadQueueSources(courseId),
  ]);
  const courseNames = new Map(courses.map((c) => [c.id, c.name]));
  const plans = await Promise.all(
    allPlans.filter((p) => courseId === null || p.course_id === courseId).map((p) => absorbMissedDays(p, today))
  );
  // Exam mode per course: no new chapters in an exam's final days, a mock
  // exam when one is due, more mixed practice.
  const examInfo = new Map(
    await Promise.all(courses.map(async (c) => [c.id, await loadCourseExamInfo(c.id, now)] as const))
  );
  const profiles = new Map(
    await Promise.all(
      [...examInfo].filter(([, i]) => i.mode.mockExamDue).map(async ([id]) => [id, await getExamProfile(id)] as const)
    )
  );
  const chapters = chapterCandidates(plans, courseNames, today).filter(
    (c) => !examInfo.get(c.courseId)?.mode.noNewMaterial
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
  const minutes = options.minutes ?? Math.max(DEFAULT_TODAY_MINUTES, scheduledMinutes + 15);

  const steps = planDay({
    minutes,
    courseId,
    reviews: queue.counts,
    mistakes: { sure: mistakes.filter((m) => m.confidence === "sure").length, total: mistakes.length },
    mockExams,
    chapters,
    weakConcepts: weak.sort((a, b) => a.recall - b.recall),
    examMode: inExamMode,
  });
  return { minutes, steps, date: today };
}
