import { eq, inArray } from "drizzle-orm";
import { db, exam_dates, exam_profiles, mock_exam_attempts, mock_exams, study_plan_chapters, study_plans } from "../db";
import { parseStudyPlanOptions } from "../studyPlan/options";
import { getAppSettings, listDocumentSummariesForCourse } from "../models";
import { conceptKey } from "../conceptName";
import { nowUtc } from "../time";
import { getStudyPlanForCourse } from "../studyPlan/store";
import { listConceptsForCourse } from "../review/concepts";
import { ensureFsrsMigrated } from "../review/legacyMigration";
import { loadQueueSources } from "../review/queue";
import { listMockExams } from "../exams/store";
import { buildForecast, daysUntil, type Forecast } from "./forecast";
import { EXAM_MODE_DAYS, examMode, type ExamMode } from "./examMode";

// A course's exam date — or any goal date, for a course without an exam —
// set on its readiness page. Without one, the study plan's finish date
// stands in.

export async function getExamDate(courseId: number): Promise<string | null> {
  const [row] = await db.select().from(exam_dates).where(eq(exam_dates.course_id, courseId)).limit(1);
  return row?.date ?? null;
}

export async function setExamDate(courseId: number, date: string | null): Promise<void> {
  if (date === null) {
    await db.delete(exam_dates).where(eq(exam_dates.course_id, courseId));
    return;
  }
  const updated_at = nowUtc();
  await db
    .insert(exam_dates)
    .values({ course_id: courseId, date, updated_at })
    .onConflictDoUpdate({ target: exam_dates.course_id, set: { date, updated_at } });
}

export interface CourseExamInfo {
  examDate: string | null;
  // Where the date came from: set on the readiness page, or the plan.
  source: "set" | "plan" | null;
  mode: ExamMode;
}

function parseUtcDays(text: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${text.replace(" ", "T")}Z`)) / 86_400_000);
}

export async function loadCourseExamInfo(courseId: number, now = new Date()): Promise<CourseExamInfo> {
  return (await loadCoursesExamInfo([courseId], now)).get(courseId) as CourseExamInfo;
}

// Batched over courses (the Today autopilot checks every one): a few
// narrow queries for the whole set instead of loading each course's full
// plan and exams.
export async function loadCoursesExamInfo(courseIds: number[], now = new Date()): Promise<Map<number, CourseExamInfo>> {
  const result = new Map<number, CourseExamInfo>();
  if (courseIds.length === 0) return result;
  const [dates, plans, profiles, attempts] = await Promise.all([
    db
      .select({ course_id: exam_dates.course_id, date: exam_dates.date })
      .from(exam_dates)
      .where(inArray(exam_dates.course_id, courseIds)),
    db
      .select({ id: study_plans.id, course_id: study_plans.course_id, options_json: study_plans.options_json })
      .from(study_plans)
      .where(inArray(study_plans.course_id, courseIds)),
    db
      .select({ course_id: exam_profiles.course_id })
      .from(exam_profiles)
      .where(inArray(exam_profiles.course_id, courseIds)),
    db
      .select({ course_id: mock_exams.course_id, started_at: mock_exam_attempts.started_at })
      .from(mock_exam_attempts)
      .innerJoin(mock_exams, eq(mock_exams.id, mock_exam_attempts.mock_exam_id))
      .where(inArray(mock_exams.course_id, courseIds)),
  ]);
  const planIds = plans.map((p) => p.id);
  const plansWithChapters = new Set(
    planIds.length
      ? (
          await db
            .selectDistinct({ plan_id: study_plan_chapters.plan_id })
            .from(study_plan_chapters)
            .where(inArray(study_plan_chapters.plan_id, planIds))
        ).map((r) => r.plan_id)
      : []
  );
  const dateOf = new Map(dates.map((d) => [d.course_id, d.date]));
  const planOf = new Map(plans.map((p) => [p.course_id, p]));
  const hasProfile = new Set(profiles.map((p) => p.course_id));
  const lastStart = new Map<number, string>();
  for (const a of attempts) {
    const prev = lastStart.get(a.course_id);
    if (!prev || a.started_at > prev) lastStart.set(a.course_id, a.started_at);
  }

  await Promise.all(
    courseIds.map(async (courseId) => {
      const set = dateOf.get(courseId) ?? null;
      const plan = planOf.get(courseId);
      const examDate = set ?? (plan ? parseStudyPlanOptions(plan.options_json).deadline : null) ?? null;
      const daysLeft = examDate ? daysUntil(examDate, now) : null;
      const last = lastStart.get(courseId);
      const lastMock = last ? parseUtcDays(last, now) : null;
      // Without analysed past exams a skill check stands in (lib/exams/
      // topicProfile.ts), as long as there's something to test. Only looked
      // up inside the exam window, where it matters.
      const inWindow = daysLeft !== null && daysLeft >= 0 && daysLeft <= EXAM_MODE_DAYS;
      const canMock =
        hasProfile.has(courseId) ||
        (inWindow &&
          ((!!plan && plansWithChapters.has(plan.id)) ||
            (await listConceptsForCourse(courseId)).length > 0 ||
            (await listDocumentSummariesForCourse(courseId)).some((d) => d.status === "extracted")));
      result.set(courseId, {
        examDate,
        source: set ? "set" : examDate ? "plan" : null,
        mode: examMode(daysLeft, lastMock, canMock),
      });
    })
  );
  return result;
}

export interface Readiness extends CourseExamInfo {
  forecast: Forecast | null;
  planDeadline: string | null;
  mockScores: { title: string; date: string; fraction: number }[];
}

export async function loadReadiness(courseId: number, now = new Date()): Promise<Readiness> {
  await ensureFsrsMigrated();
  const [info, sources, concepts, plan, exams, { reviewRetention }] = await Promise.all([
    loadCourseExamInfo(courseId, now),
    loadQueueSources(courseId),
    listConceptsForCourse(courseId),
    getStudyPlanForCourse(courseId),
    listMockExams(courseId),
    getAppSettings(),
  ]);
  const chapterTitles = new Map((plan?.chapters ?? []).map((c) => [c.id, c.title]));
  const chapterByConcept = new Map<string, { id: number; title: string }>();
  for (const c of concepts) {
    if (c.chapter_id !== null && chapterTitles.has(c.chapter_id)) {
      chapterByConcept.set(conceptKey(c.name), { id: c.chapter_id, title: chapterTitles.get(c.chapter_id) as string });
    }
  }
  const mockScores = exams
    .flatMap((e) =>
      e.attempts
        .filter((a) => a.status === "graded" && a.score !== null)
        .map((a) => ({ title: e.title, date: a.started_at, fraction: (a.score as number) / e.total_points }))
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...info,
    planDeadline: plan?.options.deadline ?? null,
    mockScores,
    forecast: info.examDate
      ? buildForecast(sources, { examDate: info.examDate, now, retention: reviewRetention, chapterByConcept })
      : null,
  };
}
