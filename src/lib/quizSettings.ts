import type { QuizGenerationSettings } from "./types";

// The quiz question-type mix from a generate request body. Falls back to
// "no settings" (generateQuiz's own unrestricted default) rather than a
// request with every type off, which would leave the prompt with nothing to
// ask for.
export function parseQuizSettings(value: unknown): QuizGenerationSettings | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const singleChoice = !!v.singleChoice;
  const multipleChoice = !!v.multipleChoice;
  const shortAnswer = !!v.shortAnswer;
  if (!singleChoice && !multipleChoice && !shortAnswer) return undefined;
  return { singleChoice, multipleChoice, shortAnswer };
}
