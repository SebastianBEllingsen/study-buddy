import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import {
  db,
  explain_sessions,
  generated_items,
  mistakes,
  mock_exam_attempts,
  mock_exams,
  quiz_attempts,
  study_plan_sessions,
  study_plans,
} from "../db";
import { localToday } from "../studyPlan/schedule";
import { listReviewLogsSince } from "../review/store";
import { listMistakes } from "../review/mistakes";
import { calibrationTable, calibrationVerdict, topMisconceptions, type CalibrationRow, type WeekSummary } from "./summary";

// The insights page: calibration over the last 30 days and a review of the
// last 7, across every course or one.

const DAY = 86_400_000;

function utcText(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export interface Insights {
  calibration: CalibrationRow[];
  calibrationVerdict: string | null;
  week: WeekSummary;
  misconceptions: { misconception: string; concept: string | null }[];
}

export async function loadInsights(courseId: number | null, now = new Date()): Promise<Insights> {
  const monthAgo = utcText(new Date(now.getTime() - 30 * DAY));
  const weekAgo = utcText(new Date(now.getTime() - 7 * DAY));
  const weekAgoDay = localToday(new Date(now.getTime() - 7 * DAY));
  const today = localToday(now);
  const inCourse = <T extends { course_id: number }>(rows: T[]) =>
    courseId === null ? rows : rows.filter((r) => r.course_id === courseId);

  const [logs, quizzes, exams, explained, created, resolved, sessions, open] = await Promise.all([
    listReviewLogsSince(monthAgo),
    db
      .select({ course_id: generated_items.course_id })
      .from(quiz_attempts)
      .innerJoin(generated_items, eq(generated_items.id, quiz_attempts.generated_item_id))
      .where(and(isNotNull(quiz_attempts.completed_at), gte(quiz_attempts.completed_at, weekAgo))),
    db
      .select({ course_id: mock_exams.course_id })
      .from(mock_exam_attempts)
      .innerJoin(mock_exams, eq(mock_exams.id, mock_exam_attempts.mock_exam_id))
      .where(and(eq(mock_exam_attempts.status, "graded"), gte(mock_exam_attempts.started_at, weekAgo))),
    db
      .select({ course_id: explain_sessions.course_id })
      .from(explain_sessions)
      .where(and(eq(explain_sessions.status, "done"), gte(explain_sessions.updated_at, weekAgo))),
    db
      .select({ course_id: generated_items.course_id })
      .from(mistakes)
      .innerJoin(generated_items, eq(generated_items.id, mistakes.generated_item_id))
      .where(gte(mistakes.created_at, weekAgo)),
    db
      .select({ course_id: generated_items.course_id })
      .from(mistakes)
      .innerJoin(generated_items, eq(generated_items.id, mistakes.generated_item_id))
      .where(gte(mistakes.resolved_at, weekAgo)),
    db
      .select({ course_id: study_plans.course_id, minutes: study_plan_sessions.minutes, done_at: study_plan_sessions.done_at })
      .from(study_plan_sessions)
      .innerJoin(study_plans, eq(study_plans.id, study_plan_sessions.plan_id))
      .where(and(gte(study_plan_sessions.date, weekAgoDay), lte(study_plan_sessions.date, today))),
    listMistakes({ courseId, status: "open" }),
  ]);

  const scopedLogs = inCourse(logs);
  const weekLogs = scopedLogs.filter((l) => l.reviewed_at >= weekAgo);
  const scopedSessions = inCourse(sessions);
  const calibration = calibrationTable(scopedLogs);
  return {
    calibration,
    calibrationVerdict: calibrationVerdict(calibration),
    week: {
      reviews: weekLogs.length,
      reviewAccuracy: weekLogs.length ? weekLogs.filter((l) => l.correct).length / weekLogs.length : null,
      quizzes: inCourse(quizzes).length,
      mockExams: inCourse(exams).length,
      explained: inCourse(explained).length,
      newMistakes: inCourse(created).length,
      resolvedMistakes: inCourse(resolved).length,
      plannedMinutes: scopedSessions.reduce((n, s) => n + s.minutes, 0),
      doneMinutes: scopedSessions.filter((s) => s.done_at).reduce((n, s) => n + s.minutes, 0),
      activeDays: new Set(weekLogs.map((l) => l.reviewed_at.slice(0, 10))).size,
    },
    misconceptions: topMisconceptions(open),
  };
}
