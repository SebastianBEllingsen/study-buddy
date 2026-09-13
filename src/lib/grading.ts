import { generateStructured } from "./aiClient";
import type { GradingResult } from "./types";
import { assertGradingResultShape } from "./aiResponseValidation";

export interface ShortAnswerToGrade {
  question: string;
  modelAnswer: string;
  userAnswer: string;
}

const GRADING_SYSTEM_PROMPT = `You are grading a student's short-answer quiz responses against model answers.

For each question, decide a verdict:
- "correct": captures the key point(s) of the model answer.
- "partial": on the right track but missing something important or partly wrong.
- "incorrect": misses the point or is wrong.

Give brief, specific feedback (1-2 sentences) explaining the verdict.

Respond with ONLY a single valid JSON object, no prose, no markdown code fences, matching exactly this shape, with one entry per question in the same order given:

{
  "results": [
    { "verdict": "correct" | "partial" | "incorrect", "feedback": "..." }
  ]
}`;

export async function gradeShortAnswers(
  items: ShortAnswerToGrade[]
): Promise<GradingResult> {
  if (items.length === 0) {
    return { results: [] };
  }

  const user = items
    .map(
      (item, i) =>
        `Question ${i + 1}: ${item.question}\nModel answer: ${item.modelAnswer}\nStudent answer: ${item.userAnswer || "(no answer given)"}`
    )
    .join("\n\n");

  const result = await generateStructured<GradingResult>({
    system: GRADING_SYSTEM_PROMPT,
    user,
    effort: "low",
    maxTokens: 4000,
  });
  assertGradingResultShape(result, items.length);
  return result;
}
