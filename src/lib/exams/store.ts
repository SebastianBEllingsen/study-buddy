import { desc, eq } from "drizzle-orm";
import { db, exam_profiles, mock_exam_attempts, mock_exams } from "../db";
import type { AiBackend } from "../models";
import { nowUtc } from "../time";
import type { AttemptStatus, ExamProfile, MockExam, MockExamAttempt, MockExamTask, TaskAnswer, TaskResult } from "./types";

type ExamRow = typeof mock_exams.$inferSelect;
type AttemptRow = typeof mock_exam_attempts.$inferSelect;

export interface StoredExamProfile {
  courseId: number;
  sourceDocumentIds: number[];
  profile: ExamProfile;
  updatedAt: string;
}

export async function getExamProfile(courseId: number): Promise<StoredExamProfile | null> {
  const [row] = await db.select().from(exam_profiles).where(eq(exam_profiles.course_id, courseId)).limit(1);
  if (!row) return null;
  return {
    courseId,
    sourceDocumentIds: JSON.parse(row.source_document_ids_json),
    profile: JSON.parse(row.profile_json),
    updatedAt: row.updated_at,
  };
}

export async function saveExamProfile(input: {
  courseId: number;
  sourceDocumentIds: number[];
  profile: ExamProfile;
  model: { provider: AiBackend; model: string } | null;
}): Promise<void> {
  const now = nowUtc();
  const fields = {
    source_document_ids_json: JSON.stringify(input.sourceDocumentIds),
    profile_json: JSON.stringify(input.profile),
    model_provider: input.model?.provider ?? null,
    model_name: input.model?.model ?? null,
    updated_at: now,
  };
  await db
    .insert(exam_profiles)
    .values({ course_id: input.courseId, ...fields, created_at: now })
    .onConflictDoUpdate({ target: exam_profiles.course_id, set: fields });
}

function toExam(row: ExamRow): MockExam {
  return {
    id: row.id,
    course_id: row.course_id,
    title: row.title,
    duration_minutes: row.duration_minutes,
    total_points: row.total_points,
    tasks: JSON.parse(row.tasks_json) as MockExamTask[],
    practice_item_id: row.practice_item_id,
    created_at: row.created_at,
  };
}

function toAttempt(row: AttemptRow): MockExamAttempt {
  return {
    id: row.id,
    mock_exam_id: row.mock_exam_id,
    status: row.status,
    answers: JSON.parse(row.answers_json) as TaskAnswer[],
    results: row.results_json ? (JSON.parse(row.results_json) as TaskResult[]) : null,
    score: row.score,
    error_message: row.error_message,
    started_at: row.started_at,
    paused_at: row.paused_at,
    paused_seconds: row.paused_seconds,
    submitted_at: row.submitted_at,
  };
}

export async function createMockExam(input: {
  courseId: number;
  title: string;
  durationMinutes: number;
  tasks: MockExamTask[];
  model: { provider: AiBackend; model: string } | null;
}): Promise<MockExam> {
  const [row] = await db
    .insert(mock_exams)
    .values({
      course_id: input.courseId,
      title: input.title,
      duration_minutes: input.durationMinutes,
      total_points: input.tasks.reduce((n, t) => n + t.points, 0),
      tasks_json: JSON.stringify(input.tasks),
      model_provider: input.model?.provider ?? null,
      model_name: input.model?.model ?? null,
      created_at: nowUtc(),
    })
    .returning();
  return toExam(row);
}

export async function getMockExam(id: number): Promise<MockExam | null> {
  const [row] = await db.select().from(mock_exams).where(eq(mock_exams.id, id)).limit(1);
  return row ? toExam(row) : null;
}

export interface MockExamSummary extends Omit<MockExam, "tasks"> {
  taskCount: number;
  attempts: { id: number; status: AttemptStatus; score: number | null; started_at: string }[];
}

export async function listMockExams(courseId: number): Promise<MockExamSummary[]> {
  const rows = await db
    .select()
    .from(mock_exams)
    .where(eq(mock_exams.course_id, courseId))
    .orderBy(desc(mock_exams.created_at), desc(mock_exams.id));
  const out: MockExamSummary[] = [];
  for (const row of rows) {
    const { tasks, ...exam } = toExam(row);
    const attempts = await db
      .select({
        id: mock_exam_attempts.id,
        status: mock_exam_attempts.status,
        score: mock_exam_attempts.score,
        started_at: mock_exam_attempts.started_at,
      })
      .from(mock_exam_attempts)
      .where(eq(mock_exam_attempts.mock_exam_id, row.id))
      .orderBy(desc(mock_exam_attempts.started_at), desc(mock_exam_attempts.id));
    out.push({ ...exam, taskCount: tasks.length, attempts });
  }
  return out;
}

export async function deleteMockExam(id: number): Promise<void> {
  await db.delete(mock_exams).where(eq(mock_exams.id, id));
}

export async function setPracticeItem(examId: number, itemId: number): Promise<void> {
  await db.update(mock_exams).set({ practice_item_id: itemId }).where(eq(mock_exams.id, examId));
}

export async function createAttempt(examId: number, taskCount: number): Promise<MockExamAttempt> {
  const [row] = await db
    .insert(mock_exam_attempts)
    .values({
      mock_exam_id: examId,
      status: "in_progress",
      answers_json: JSON.stringify(Array.from({ length: taskCount }, () => ({ text: "", images: [] }))),
      started_at: nowUtc(),
    })
    .returning();
  return toAttempt(row);
}

export async function getAttempt(id: number): Promise<MockExamAttempt | null> {
  const [row] = await db.select().from(mock_exam_attempts).where(eq(mock_exam_attempts.id, id)).limit(1);
  return row ? toAttempt(row) : null;
}

export async function saveAnswers(id: number, answers: TaskAnswer[]): Promise<void> {
  await db.update(mock_exam_attempts).set({ answers_json: JSON.stringify(answers) }).where(eq(mock_exam_attempts.id, id));
}

export async function setAttemptStatus(
  id: number,
  status: AttemptStatus,
  extra: { submitted?: boolean; errorMessage?: string | null } = {}
): Promise<void> {
  await db
    .update(mock_exam_attempts)
    .set({
      status,
      ...(extra.submitted && { submitted_at: nowUtc() }),
      ...(extra.errorMessage !== undefined && { error_message: extra.errorMessage }),
    })
    .where(eq(mock_exam_attempts.id, id));
}

export async function saveResults(id: number, results: TaskResult[], score: number): Promise<void> {
  await db
    .update(mock_exam_attempts)
    .set({ status: "graded", results_json: JSON.stringify(results), score, error_message: null })
    .where(eq(mock_exam_attempts.id, id));
}

// Stops or restarts the exam clock (see lib/exams/timing.ts).
export async function setAttemptPaused(attempt: MockExamAttempt, paused: boolean, now = new Date()): Promise<void> {
  if (paused === (attempt.paused_at !== null)) return;
  if (paused) {
    await db.update(mock_exam_attempts).set({ paused_at: nowUtc() }).where(eq(mock_exam_attempts.id, attempt.id));
    return;
  }
  const since = Date.parse(`${(attempt.paused_at as string).replace(" ", "T")}Z`);
  const seconds = Math.max(0, Math.round((now.getTime() - since) / 1000));
  await db
    .update(mock_exam_attempts)
    .set({ paused_at: null, paused_seconds: attempt.paused_seconds + seconds })
    .where(eq(mock_exam_attempts.id, attempt.id));
}

export async function deleteAttempt(id: number): Promise<void> {
  await db.delete(mock_exam_attempts).where(eq(mock_exam_attempts.id, id));
}
