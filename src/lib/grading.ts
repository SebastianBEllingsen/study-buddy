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

// AI-free fallback — see app_settings.ai_grading_enabled. No API call, so no
// nuance: a plain word-overlap check against the model answer rather than
// real semantic judgment, and always a binary correct/incorrect verdict
// (never "partial" — that judgment call is exactly what needs an AI to make;
// a coded heuristic has no basis for it). Good enough to unblock "was this
// roughly right" without spending a grading call on every attempt; anyone
// who wants the more accurate read can turn AI grading back on in Settings.
// Filtered out before scoring — otherwise a student who writes only the
// exact right content words ("mitochondria powerhouse cell") scores worse
// than the model answer's own filler ("the mitochondria IS the powerhouse
// OF the cell") would suggest, since those words never had any content to
// match in the first place and only dilute the denominator.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "in", "on", "at", "to", "for", "and", "or", "but", "with", "as",
  "by", "that", "this", "these", "those", "it", "its", "from", "which",
  "who", "what", "when", "where", "why", "how", "do", "does", "did",
]);

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

// How much of the model answer's own (content) vocabulary shows up in the
// student's answer — recall-oriented (missing the model answer's content
// matters more here than extra words the student added around it).
const CORRECT_THRESHOLD = 0.6;

export function gradeShortAnswersLocally(items: ShortAnswerToGrade[]): GradingResult {
  return {
    results: items.map((item) => {
      const modelWords = new Set(normalizeWords(item.modelAnswer));
      const userWords = new Set(normalizeWords(item.userAnswer));
      if (modelWords.size === 0 || userWords.size === 0) {
        return {
          verdict: "incorrect",
          feedback: "No answer given — AI grading is off, see the model answer above.",
        };
      }
      let overlap = 0;
      for (const w of modelWords) if (userWords.has(w)) overlap++;
      const score = overlap / modelWords.size;
      return score >= CORRECT_THRESHOLD
        ? { verdict: "correct", feedback: "Matches the model answer closely enough (keyword match — AI grading is off)." }
        : { verdict: "incorrect", feedback: "Doesn't match the model answer closely enough (keyword match — AI grading is off)." };
    }),
  };
}
