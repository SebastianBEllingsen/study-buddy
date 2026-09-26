import { getAppSettings } from "./models";
import { gradeShortAnswers, gradeShortAnswersLocally } from "./grading";
import type { QuizQuestion } from "./types";

// Grading quiz answers — shared by a full quiz attempt and single questions
// answered in the review session. Multiple choice is graded here; short
// answers go out in one batched AI call (or the local fallback when AI
// grading is off).

export type QuizAnswer = number | string | number[] | null | undefined;
export type AnswerVerdictValue = "correct" | "partial" | "incorrect";

export interface AttemptResultEntry {
  index: number;
  type: QuizQuestion["type"];
  correct: boolean;
  verdict?: AnswerVerdictValue;
  feedback: string;
  explanation: string;
  correctAnswer: string;
}

// The question's answer as text, for the mistake log.
export function answerText(question: QuizQuestion, answer: QuizAnswer): string | null {
  if (question.type === "mcq") {
    return typeof answer === "number" && question.options[answer] !== undefined ? question.options[answer] : null;
  }
  if (question.type === "multi_select") {
    if (!Array.isArray(answer) || answer.length === 0) return null;
    return answer
      .map((i) => question.options[i])
      .filter((o) => o !== undefined)
      .join(", ");
  }
  const text = typeof answer === "string" ? answer.trim() : "";
  return text || null;
}

export function correctAnswerText(question: QuizQuestion): string {
  if (question.type === "mcq") return question.options[question.correctIndex];
  if (question.type === "multi_select") return question.correctIndices.map((i) => question.options[i]).join(", ");
  return question.modelAnswer;
}

// `entries` pairs each question with its index in the quiz (so a single
// question keeps its real index) and the learner's answer.
export async function gradeQuizAnswers(
  entries: { index: number; question: QuizQuestion; answer: QuizAnswer }[]
): Promise<AttemptResultEntry[]> {
  const shortAnswerPositions: number[] = [];
  const shortAnswerPayload: { question: string; modelAnswer: string; userAnswer: string }[] = [];
  const results: AttemptResultEntry[] = entries.map(({ index, question: q, answer }, position) => {
    if (q.type === "mcq") {
      const correct = answer === q.correctIndex;
      return {
        index,
        type: "mcq" as const,
        correct,
        feedback: correct ? "Correct." : "Incorrect.",
        explanation: q.explanation,
        correctAnswer: correctAnswerText(q),
      };
    }
    if (q.type === "multi_select") {
      const selectedSet = new Set(Array.isArray(answer) ? answer : []);
      const correctSet = new Set(q.correctIndices);
      // Exact match — every correct option selected, no incorrect ones.
      // No partial credit: consistent with mcq's own all-or-nothing grading.
      const correct = selectedSet.size === correctSet.size && [...selectedSet].every((i) => correctSet.has(i));
      return {
        index,
        type: "multi_select" as const,
        correct,
        feedback: correct ? "Correct." : "Incorrect.",
        explanation: q.explanation,
        correctAnswer: correctAnswerText(q),
      };
    }
    shortAnswerPositions.push(position);
    shortAnswerPayload.push({ question: q.question, modelAnswer: q.modelAnswer, userAnswer: String(answer ?? "") });
    // Placeholder, filled in below once grading returns.
    return {
      index,
      type: "short_answer" as const,
      correct: false,
      feedback: "",
      explanation: q.explanation,
      correctAnswer: q.modelAnswer,
    };
  });

  if (shortAnswerPayload.length > 0) {
    const { aiEnabled, aiGradingEnabled } = await getAppSettings();
    const graded =
      aiEnabled && aiGradingEnabled
        ? await gradeShortAnswers(shortAnswerPayload)
        : gradeShortAnswersLocally(shortAnswerPayload);
    graded.results.forEach((g, i) => {
      const result = results[shortAnswerPositions[i]];
      result.verdict = g.verdict;
      result.feedback = g.feedback;
      result.correct = g.verdict === "correct";
    });
  }
  return results;
}

export function verdictOf(result: AttemptResultEntry): AnswerVerdictValue {
  return result.verdict ?? (result.correct ? "correct" : "incorrect");
}

export function scoreFromResults(results: AttemptResultEntry[]): number {
  const points = results.reduce((sum, r) => {
    if (r.verdict === "partial") return sum + 0.5;
    return sum + (r.correct ? 1 : 0);
  }, 0);
  return results.length > 0 ? (points / results.length) * 100 : 0;
}
