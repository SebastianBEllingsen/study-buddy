import { getGeneratedItem, createQuizAttempt, completeQuizAttempt, getAppSettings } from "@/lib/models";
import { gradeShortAnswers, gradeShortAnswersLocally } from "@/lib/grading";
import { describeAiError } from "@/lib/aiClient";
import type { QuizContent, QuizQuestion } from "@/lib/types";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

interface AttemptResultEntry {
  index: number;
  type: QuizQuestion["type"];
  correct: boolean;
  verdict?: "correct" | "partial" | "incorrect";
  feedback: string;
  explanation: string;
  correctAnswer: string;
}

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return Response.json({ error: "Quiz item not found" }, { status: 404 });
  try {
    const item = await getGeneratedItem(id);
    if (!item || item.mode !== "quiz") {
      return Response.json({ error: "Quiz item not found" }, { status: 404 });
    }

    const body = await request.json();
    const answers: (number | string | number[])[] = Array.isArray(body?.answers) ? body.answers : [];

    const content = JSON.parse(item.content_json) as QuizContent;
    const attempt = await createQuizAttempt(item.id);

    // Grade MCQ/multi-select locally (no API call needed) and collect
    // short-answer questions for a single batched grading call.
    const shortAnswerIndices: number[] = [];
    const shortAnswerPayload: { question: string; modelAnswer: string; userAnswer: string }[] = [];
    const results: AttemptResultEntry[] = content.questions.map((q, index) => {
      if (q.type === "mcq") {
        const selected = answers[index];
        const correct = selected === q.correctIndex;
        return {
          index,
          type: "mcq" as const,
          correct,
          feedback: correct ? "Correct." : "Incorrect.",
          explanation: q.explanation,
          correctAnswer: q.options[q.correctIndex],
        };
      }
      if (q.type === "multi_select") {
        const selected = Array.isArray(answers[index]) ? (answers[index] as number[]) : [];
        const selectedSet = new Set(selected);
        const correctSet = new Set(q.correctIndices);
        // Exact match — every correct option selected, no incorrect ones.
        // No partial credit: consistent with mcq's own all-or-nothing grading.
        const correct =
          selectedSet.size === correctSet.size && [...selectedSet].every((i) => correctSet.has(i));
        return {
          index,
          type: "multi_select" as const,
          correct,
          feedback: correct ? "Correct." : "Incorrect.",
          explanation: q.explanation,
          correctAnswer: q.correctIndices.map((i) => q.options[i]).join(", "),
        };
      }
      shortAnswerIndices.push(index);
      shortAnswerPayload.push({
        question: q.question,
        modelAnswer: q.modelAnswer,
        userAnswer: String(answers[index] ?? ""),
      });
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
      const { aiGradingEnabled } = await getAppSettings();
      const graded = aiGradingEnabled
        ? await gradeShortAnswers(shortAnswerPayload)
        : gradeShortAnswersLocally(shortAnswerPayload);
      graded.results.forEach((g, i) => {
        const resultIndex = shortAnswerIndices[i];
        results[resultIndex].verdict = g.verdict;
        results[resultIndex].feedback = g.feedback;
        results[resultIndex].correct = g.verdict === "correct";
      });
    }

    const points = results.reduce((sum, r) => {
      if (r.verdict === "partial") return sum + 0.5;
      return sum + (r.correct ? 1 : 0);
    }, 0);
    const score = results.length > 0 ? (points / results.length) * 100 : 0;

    await completeQuizAttempt({ id: attempt.id, score, answersJson: results });

    return Response.json({ attemptId: attempt.id, score, results });
  } catch (err) {
    console.error("Grading quiz attempt failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
