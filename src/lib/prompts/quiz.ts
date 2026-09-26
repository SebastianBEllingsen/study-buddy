import { SOURCE_NAME_RULE, SOURCE_TRUST_RULE } from "./sources";
import type { QuizGenerationSettings } from "../types";

// Exported so chunked generation (generate.ts) can distribute this same
// total across chunks instead of asking each chunk for a full 12 — without
// that, a large course split into N chunks would come back with N*12
// questions instead of 12.
export const TOTAL_QUESTIONS = 12;

// Even split across whichever types are enabled, remainder going to the
// earliest ones (e.g. 12 across 3 types → 4/4/4; across 2 → 6/6). Exported
// only for its own unit test (see quiz.test.ts) — every real call site is
// still within this file.
export function distributeCount(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  let remainder = total % parts;
  return Array.from({ length: parts }, () => base + (remainder-- > 0 ? 1 : 0));
}

function quizComposition(
  settings?: QuizGenerationSettings,
  total: number = TOTAL_QUESTIONS
): { instructions: string; shapeExamples: string[] } {
  // No settings (only the supplement/"add new material" flow calls this way
  // today) — the exact original behavior, unchanged: a fixed 8 mcq / 4
  // short-answer mix (scaled to `total`), no multi-select.
  if (!settings) {
    // 2:1 mcq:short-answer ratio, same as the original fixed 8/4 split at
    // the default total of 12 — scaled proportionally for chunked
    // generation's smaller per-chunk totals, with at least 1 of each.
    const mcqCount = Math.max(1, Math.round((total * 2) / 3));
    const shortCount = Math.max(1, total - mcqCount);
    return {
      instructions: `Generate a mix of ${mcqCount} multiple-choice questions and ${shortCount} short-answer questions (${total} total), covering the material broadly rather than clustering on one topic.\n- Multiple-choice questions must have exactly 4 options with exactly one correct answer.`,
      shapeExamples: [
        '{ "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "...", "concept": "...", "source": "..." }',
        '{ "type": "short_answer", "question": "...", "modelAnswer": "...", "explanation": "...", "concept": "...", "source": "..." }',
      ],
    };
  }

  const enabled = (["singleChoice", "multipleChoice", "shortAnswer"] as const).filter((k) => settings[k]);
  const counts = distributeCount(total, enabled.length || 1);
  const lines: string[] = [];
  const shapeExamples: string[] = [];

  enabled.forEach((kind, i) => {
    if (kind === "singleChoice") {
      lines.push(
        `${counts[i]} single-choice questions (type "mcq") — exactly 4 options, exactly ONE correct answer given as "correctIndex".`
      );
      shapeExamples.push(
        '{ "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "...", "concept": "...", "source": "..." }'
      );
    } else if (kind === "multipleChoice") {
      lines.push(
        `${counts[i]} multiple-choice questions (type "multi_select") — "select all that apply", exactly 4-5 options with TWO OR MORE correct answers given as "correctIndices" (an array of indices).`
      );
      shapeExamples.push(
        '{ "type": "multi_select", "question": "...", "options": ["...", "...", "...", "..."], "correctIndices": [0, 2], "explanation": "...", "concept": "...", "source": "..." }'
      );
    } else {
      lines.push(`${counts[i]} short-answer questions (type "short_answer") — answered with free text, graded against a model answer.`);
      shapeExamples.push('{ "type": "short_answer", "question": "...", "modelAnswer": "...", "explanation": "...", "concept": "...", "source": "..." }');
    }
  });

  return {
    instructions: `Generate exactly ${total} questions total, covering the material broadly rather than clustering on one topic:\n${lines
      .map((l) => `  - ${l}`)
      .join("\n")}`,
    shapeExamples,
  };
}

// Shared with the flashcards prompt: the concept tag every question/card
// carries (lib/review/concepts.ts groups results by it).
export const CONCEPT_RULE =
  'Tag each item with "concept": a short name (2–5 words) for the specific idea it tests. Items on the same idea share exactly the same name; use the material\'s own section or topic names where they fit.';

export function quizSystemPrompt(
  courseName: string,
  settings?: QuizGenerationSettings,
  // Overridable so chunked generation can ask each chunk for a fraction of
  // the total instead of a full TOTAL_QUESTIONS per chunk (see generate.ts).
  total: number = TOTAL_QUESTIONS
): string {
  const { instructions, shapeExamples } = quizComposition(settings, total);
  return `You are a study assistant generating a practice quiz strictly from the course material provided by the user. This is for the course "${courseName}".

Rules:
- Use ONLY the provided material. Do not invent facts or rely on outside knowledge beyond trivial clarification.
- ${SOURCE_TRUST_RULE}
- ${instructions}
- Every question needs a brief explanation of why the answer is correct.
- ${CONCEPT_RULE}
- ${SOURCE_NAME_RULE}
- Write any math notation as standard LaTeX between \`$...$\` for inline math or \`$$...$$\` for display math — never bare \`\\displaystyle\`, parenthesized notation, or other ad-hoc formatting. Remember this is going inside a JSON string, so escape backslashes correctly (e.g. \`\\\\frac\` not \`\\frac\`).
- The provided material was extracted from PDFs, so math notation may be corrupted or fragmented (e.g. symbols split across lines with no \`$\` delimiters, from an equation editor or math-typeset page). Reconstruct the intended formula from context as clean, complete, correctly-delimited LaTeX — do not copy fragmented source text verbatim.
- Respond with ONLY a single valid JSON object, no prose, no markdown code fences, matching exactly this shape:

{
  "questions": [
    ${shapeExamples.join(",\n    ")}
  ]
}`;
}

export function quizUserPrompt(courseText: string, alreadyCovered?: string): string {
  const avoidBlock = alreadyCovered
    ? `\n\nThe student's existing quiz already has these questions — write NEW questions that don't duplicate the same fact/concept:\n${alreadyCovered}\n`
    : "";
  return `Course material:\n\n${courseText}${avoidBlock}\nGenerate the quiz now.`;
}

export function retryQuizSystemPrompt(courseName: string): string {
  return `You are a study assistant for the course "${courseName}". The student just got some quiz questions wrong and wants focused practice on those same concepts.

Rules:
- For each missed question given, write ONE new question testing the same underlying concept — NOT a verbatim repeat or a trivial rewording. The student shouldn't be able to answer just by pattern-matching the earlier question.
- Multiple-choice questions must have exactly 4 options with exactly one correct answer.
- Every question needs a brief explanation of why the answer is correct.
- ${CONCEPT_RULE}
- Write any math notation as standard LaTeX between \`$...$\` for inline math or \`$$...$$\` for display math — never bare \`\\displaystyle\`, parenthesized notation, or other ad-hoc formatting. Remember this is going inside a JSON string, so escape backslashes correctly (e.g. \`\\\\frac\` not \`\\frac\`).
- The provided material was extracted from PDFs, so math notation may be corrupted or fragmented (e.g. symbols split across lines with no \`$\` delimiters, from an equation editor or math-typeset page). Reconstruct the intended formula from context as clean, complete, correctly-delimited LaTeX — do not copy fragmented source text verbatim.
- Respond with ONLY a single valid JSON object, no prose, no markdown code fences, matching exactly this shape:

{
  "questions": [
    { "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "...", "concept": "..." },
    { "type": "short_answer", "question": "...", "modelAnswer": "...", "explanation": "...", "concept": "..." }
  ]
}`;
}

export function retryQuizUserPrompt(
  missed: { question: string; correctAnswer: string; explanation: string }[]
): string {
  const list = missed
    .map(
      (m, i) =>
        `${i + 1}. Question: ${m.question}\n   Correct answer: ${m.correctAnswer}\n   Explanation: ${m.explanation}`
    )
    .join("\n\n");
  return `The student got these questions wrong:\n\n${list}\n\nWrite one new practice question per missed question above, in the same order, testing the same concept. Generate the retry quiz now.`;
}
