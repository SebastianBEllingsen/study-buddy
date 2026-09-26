import { generateText } from "../aiClient";
import { parseJsonFromText } from "../aiBackends/jsonText";
import { createGeneratedItem, getAppSettings, getGeneratedItem } from "../models";
import { languageName } from "../languages";
import { mapWithConcurrency } from "../concurrency";
import { gradingSystemPrompt, gradingUserPrompt } from "../prompts/exams";
import type { AttemptResultEntry } from "../quizGrading";
import type { QuizContent, ShortAnswerQuestion } from "../types";
import { recordQuizAnswers } from "../review/answers";
import { listMistakes, setMisconceptions } from "../review/mistakes";
import { loadAnswerImage } from "./answerImages";
import { getAttempt, getExamProfile, getMockExam, saveResults, setAttemptStatus, setPracticeItem } from "./store";
import type { MockExam, MockExamTask, TaskAnswer, TaskResult } from "./types";
import { normalizeTaskGrading } from "./validate";

// Grades a submitted attempt task by task against the rubrics written with
// the exam, then feeds the results into spaced review and the mistake log
// through the exam's practice quiz.

const GRADING_CONCURRENCY = 3;

export function blankResult(task: MockExamTask): TaskResult {
  return {
    points: 0,
    maxPoints: task.points,
    feedback: "No answer given.",
    criteria: task.rubric.map((c) => ({ criterion: c.criterion, awarded: 0, max: c.points, comment: "" })),
    misconception: null,
    transcription: null,
  };
}

async function gradeTask(task: MockExamTask, answer: TaskAnswer, language: string, efficient: boolean): Promise<TaskResult> {
  if (!answer.text.trim() && answer.images.length === 0) return blankResult(task);
  const images = (await Promise.all(answer.images.map(loadAnswerImage))).filter((i) => i !== null);
  if (answer.images.length > 0 && images.length === 0 && !answer.text.trim()) {
    throw new Error("Couldn't read the photos for one of the tasks — try uploading them again.");
  }
  const text = await generateText({
    system: gradingSystemPrompt(language),
    user: gradingUserPrompt(task, answer.text, images.length),
    images: images.length ? images : undefined,
    maxTokens: 4000,
    effort: "medium",
    efficient,
  });
  return normalizeTaskGrading(parseJsonFromText<unknown>(text), task);
}

export function verdictFor(result: TaskResult): "correct" | "partial" | "incorrect" {
  const ratio = result.maxPoints > 0 ? result.points / result.maxPoints : 0;
  return ratio >= 0.85 ? "correct" : ratio >= 0.4 ? "partial" : "incorrect";
}

// The exam's tasks as short-answer questions, so they can come back in
// spaced review like any other question.
export function practiceQuizContent(exam: MockExam): QuizContent {
  return {
    questions: exam.tasks.map(
      (task): ShortAnswerQuestion => ({
        type: "short_answer",
        question: task.prompt,
        modelAnswer: task.solution,
        explanation: task.rubric.map((c) => `${c.criterion} (${c.points} pts)`).join("; "),
        concept: task.concept,
      })
    ),
  };
}

async function practiceItemFor(exam: MockExam) {
  if (exam.practice_item_id !== null) {
    const item = await getGeneratedItem(exam.practice_item_id);
    if (item) return item;
  }
  const item = await createGeneratedItem({
    courseId: exam.course_id,
    folderId: null,
    sourceFolderId: null,
    sourceHandpicked: false,
    mode: "quiz",
    title: `Exam practice — ${exam.title}`,
    contentJson: practiceQuizContent(exam),
    sourceDocumentIds: [],
  });
  await setPracticeItem(exam.id, item.id);
  return item;
}

export async function recordExamForReview(exam: MockExam, answers: TaskAnswer[], results: TaskResult[]): Promise<void> {
  const item = await practiceItemFor(exam);
  const questions = practiceQuizContent(exam).questions;
  await recordQuizAnswers({
    item,
    source: "exam",
    entries: exam.tasks.map((task, index) => {
      const result = results[index];
      const verdict = verdictFor(result);
      const graded: AttemptResultEntry = {
        index,
        type: "short_answer",
        correct: verdict === "correct",
        verdict,
        feedback: result.feedback,
        explanation: questions[index].explanation,
        correctAnswer: task.solution,
      };
      const given = answers[index]?.text.trim() || result.transcription || null;
      return { question: questions[index], answer: given, confidence: null, result: graded };
    }),
  });
  // The grader's misconception notes go straight onto the new mistakes.
  const byIndex = new Map(results.map((r, i) => [i, r.misconception]));
  const open = (await listMistakes({ courseId: exam.course_id, status: "open" })).filter(
    (m) => m.generated_item_id === item.id && m.kind === "question"
  );
  const labels = new Map<number, string>();
  for (const m of open) {
    const note = byIndex.get(m.item_index);
    if (note) labels.set(m.id, note);
  }
  await setMisconceptions(labels);
}

export async function gradeAttempt(attemptId: number): Promise<void> {
  const attempt = await getAttempt(attemptId);
  if (!attempt) return;
  const exam = await getMockExam(attempt.mock_exam_id);
  if (!exam) return;
  try {
    const [settings, stored] = await Promise.all([getAppSettings(), getExamProfile(exam.course_id)]);
    const language = stored?.profile.language ?? languageName(settings.preferredLanguage);
    const results = await mapWithConcurrency(exam.tasks, GRADING_CONCURRENCY, (task, i) =>
      gradeTask(task, attempt.answers[i] ?? { text: "", images: [] }, language, settings.aiEfficiencyMode)
    );
    const score = results.reduce((n, r) => n + r.points, 0);
    await saveResults(attempt.id, results, score);
    try {
      await recordExamForReview(exam, attempt.answers, results);
    } catch (err) {
      console.error("Mock exam: recording results for review failed:", err);
    }
  } catch (err) {
    console.error("Mock exam: grading failed:", err);
    await setAttemptStatus(attempt.id, "failed", {
      errorMessage: err instanceof Error ? err.message : "Grading failed.",
    });
  }
}
