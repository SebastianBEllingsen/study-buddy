import { MAX_IMAGES_PER_ANSWER, isAnswerImageUrl } from "./answerImages";
import type { MockExam, MockExamAttempt, MockExamTask, TaskAnswer } from "./types";

// Request parsing and response shaping for the mock exam routes.

const MAX_ANSWER_CHARS = 30_000;

export function parseAnswers(raw: unknown, taskCount: number): TaskAnswer[] | null {
  if (!Array.isArray(raw) || raw.length !== taskCount) return null;
  const answers: TaskAnswer[] = [];
  for (const entry of raw) {
    const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!e || typeof e.text !== "string" || !Array.isArray(e.images)) return null;
    if (e.text.length > MAX_ANSWER_CHARS || e.images.length > MAX_IMAGES_PER_ANSWER) return null;
    if (!e.images.every(isAnswerImageUrl)) return null;
    answers.push({ text: e.text, images: e.images as string[] });
  }
  return answers;
}

export function parseDuration(raw: unknown): number | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  return Number.isInteger(raw) && (raw as number) >= 10 && (raw as number) <= 600 ? (raw as number) : null;
}

// While an attempt is open the learner sees the tasks, not the rubric or
// the model solution.
export type PublicTask = Omit<MockExamTask, "rubric" | "solution"> & Partial<Pick<MockExamTask, "rubric" | "solution">>;

export function examForAttempt(exam: MockExam, attempt: Pick<MockExamAttempt, "status">) {
  const reveal = attempt.status === "graded";
  return {
    ...exam,
    tasks: exam.tasks.map((t): PublicTask => (reveal ? t : { title: t.title, prompt: t.prompt, points: t.points, concept: t.concept, kind: t.kind })),
  };
}
