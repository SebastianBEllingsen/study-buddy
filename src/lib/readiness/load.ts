import { eq } from "drizzle-orm";
import { db, exam_dates } from "../db";
import { getAppSettings, listDocumentSummariesForCourse } from "../models";
import { conceptKey } from "../conceptName";
import { nowUtc } from "../time";
import { getStudyPlanForCourse } from "../studyPlan/store";
import { listConceptsForCourse } from "../review/concepts";
import { ensureFsrsMigrated } from "../review/legacyMigration";
import { loadQueueSources } from "../review/queue";
import { getExamProfile, listMockExams } from "../exams/store";
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
  const [set, plan, profile, exams] = await Promise.all([
    getExamDate(courseId),
    getStudyPlanForCourse(courseId),
    getExamProfile(courseId),
    listMockExams(courseId),
  ]);
  const examDate = set ?? plan?.options.deadline ?? null;
  const daysLeft = examDate ? daysUntil(examDate, now) : null;
  const starts = exams.flatMap((e) => e.attempts.map((a) => a.started_at)).sort();
  const lastMock = starts.length ? parseUtcDays(starts[starts.length - 1], now) : null;
  // Without analysed past exams a skill check stands in (lib/exams/
  // topicProfile.ts), as long as there's something to test. Only looked
  // up inside the exam window, where it matters.
  const inWindow = daysLeft !== null && daysLeft >= 0 && daysLeft <= EXAM_MODE_DAYS;
  const canMock =
    !!profile ||
    (inWindow &&
      (!!plan?.chapters.length ||
        (await listConceptsForCourse(courseId)).length > 0 ||
        (await listDocumentSummariesForCourse(courseId)).some((d) => d.status === "extracted")));
  return {
    examDate,
    source: set ? "set" : examDate ? "plan" : null,
    mode: examMode(daysLeft, lastMock, canMock),
  };
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
        .map((a) => ({ title: e.title, date: a.started_at.slice(0, 10), fraction: (a.score as number) / e.total_points }))
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
