// Shared, client-safe types for mock exams (lib/exams/*).

export type AttemptStatus = "in_progress" | "grading" | "graded" | "failed";

export const TASK_KINDS = ["calculation", "proof", "explanation", "short_answer", "multiple_choice", "other"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

// What analysing a course's past exams produced.
export interface ExamProfile {
  examCount: number;
  durationMinutes: number;
  totalPoints: number;
  // How tasks are worded and laid out, in a few sentences.
  style: string;
  // The exams' own language, e.g. "English".
  language: string;
  // Share of the points (0–1) per topic, largest first.
  topics: { concept: string; share: number }[];
  // The typical tasks seen, one line each.
  tasks: { title: string; concept: string; points: number; kind: TaskKind; difficulty: 1 | 2 | 3 }[];
}

export interface RubricCriterion {
  criterion: string;
  points: number;
}

export interface MockExamTask {
  title: string;
  // Markdown with $...$ LaTeX.
  prompt: string;
  points: number;
  concept: string;
  kind: TaskKind;
  // Written with the task, before any answer is seen; points add up to the task's.
  rubric: RubricCriterion[];
  solution: string;
}

export interface TaskAnswer {
  text: string;
  // Photos of handwritten work (blob or data URLs from /api/blobs).
  images: string[];
}

export interface CriterionResult {
  criterion: string;
  awarded: number;
  max: number;
  comment: string;
}

export interface TaskResult {
  points: number;
  maxPoints: number;
  feedback: string;
  criteria: CriterionResult[];
  // The misconception behind lost points, if any.
  misconception: string | null;
  // What the grader read from the photos, so the learner can check it.
  transcription: string | null;
}

export interface MockExam {
  id: number;
  course_id: number;
  title: string;
  duration_minutes: number;
  total_points: number;
  tasks: MockExamTask[];
  practice_item_id: number | null;
  created_at: string;
}

export interface MockExamAttempt {
  id: number;
  mock_exam_id: number;
  status: AttemptStatus;
  answers: TaskAnswer[];
  results: TaskResult[] | null;
  score: number | null;
  error_message: string | null;
  started_at: string;
  paused_at: string | null;
  paused_seconds: number;
  submitted_at: string | null;
}
