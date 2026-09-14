import type { QuizGenerationSettings } from "../types";

const TOTAL_QUESTIONS = 12;

// Even split across whichever types are enabled, remainder going to the
// earliest ones (e.g. 12 across 3 types → 4/4/4; across 2 → 6/6).
function distributeCount(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  let remainder = total % parts;
  return Array.from({ length: parts }, () => base + (remainder-- > 0 ? 1 : 0));
}

function quizComposition(settings?: QuizGenerationSettings): { instructions: string; shapeExamples: string[] } {
  // No settings (only the supplement/"add new material" flow calls this way
  // today) — the exact original behavior, unchanged: a fixed 8 mcq / 4
  // short-answer mix, no multi-select.
  if (!settings) {
    return {
      instructions:
        "Generate a mix of 8 multiple-choice questions and 4 short-answer questions (12 total), covering the material broadly rather than clustering on one topic.\n- Multiple-choice questions must have exactly 4 options with exactly one correct answer.",
      shapeExamples: [
        '{ "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "..." }',
        '{ "type": "short_answer", "question": "...", "modelAnswer": "...", "explanation": "..." }',
      ],
    };
  }

  const enabled = (["singleChoice", "multipleChoice", "shortAnswer"] as const).filter((k) => settings[k]);
  const counts = distributeCount(TOTAL_QUESTIONS, enabled.length || 1);
  const lines: string[] = [];
  const shapeExamples: string[] = [];

  enabled.forEach((kind, i) => {
    if (kind === "singleChoice") {
      lines.push(
        `${counts[i]} single-choice questions (type "mcq") — exactly 4 options, exactly ONE correct answer given as "correctIndex".`
      );
      shapeExamples.push(
        '{ "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "..." }'
      );
    } else if (kind === "multipleChoice") {
      lines.push(
        `${counts[i]} multiple-choice questions (type "multi_select") — "select all that apply", exactly 4-5 options with TWO OR MORE correct answers given as "correctIndices" (an array of indices).`
      );
      shapeExamples.push(
        '{ "type": "multi_select", "question": "...", "options": ["...", "...", "...", "..."], "correctIndices": [0, 2], "explanation": "..." }'
      );
    } else {
      lines.push(`${counts[i]} short-answer questions (type "short_answer") — answered with free text, graded against a model answer.`);
      shapeExamples.push('{ "type": "short_answer", "question": "...", "modelAnswer": "...", "explanation": "..." }');
    }
  });

  return {
    instructions: `Generate exactly ${TOTAL_QUESTIONS} questions total, covering the material broadly rather than clustering on one topic:\n${lines
      .map((l) => `  - ${l}`)
      .join("\n")}`,
    shapeExamples,
  };
}

export function quizSystemPrompt(courseName: string, settings?: QuizGenerationSettings): string {
  const { instructions, shapeExamples } = quizComposition(settings);
  return `You are a study assistant generating a practice quiz strictly from the course material provided by the user. This is for the course "${courseName}".

Rules:
- Use ONLY the provided material. Do not invent facts or rely on outside knowledge beyond trivial clarification.
- ${instructions}
- Every question needs a brief explanation of why the answer is correct.
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
- Write any math notation as standard LaTeX between \`$...$\` for inline math or \`$$...$$\` for display math — never bare \`\\displaystyle\`, parenthesized notation, or other ad-hoc formatting. Remember this is going inside a JSON string, so escape backslashes correctly (e.g. \`\\\\frac\` not \`\\frac\`).
- The provided material was extracted from PDFs, so math notation may be corrupted or fragmented (e.g. symbols split across lines with no \`$\` delimiters, from an equation editor or math-typeset page). Reconstruct the intended formula from context as clean, complete, correctly-delimited LaTeX — do not copy fragmented source text verbatim.
- Respond with ONLY a single valid JSON object, no prose, no markdown code fences, matching exactly this shape:

{
  "questions": [
    { "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "..." },
    { "type": "short_answer", "question": "...", "modelAnswer": "...", "explanation": "..." }
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
