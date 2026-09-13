import katex from "katex";
import type { NotesContent, QuizContent, FlashcardsContent } from "./types";
import { assertQuizContentShape, assertFlashcardsContentShape } from "./aiResponseValidation";

// Shared with MathText.tsx — the one definition of "what counts as a
// complete, matched math span," used both for rendering and for stripping
// orphaned delimiters after generation.
export const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

// Two ORPHAN delimiters (e.g. two separate lines each ending in a stray,
// unopened `$$` — the known generation-merge bug) can accidentally look like
// one legitimate matched pair to MATH_PATTERN's lazy match, silently
// swallowing everything between them (including unrelated prose) as if it
// were a single formula. Guard against that: reject a "match" as fake math
// if its content contains a colon (real formulas in this app's domain don't
// use bare colons; every observed false-pair case is exactly two
// "Label: <formula>" lines bridged together) or fails to parse as LaTeX.
function looksLikeRealMath(tex: string): boolean {
  if (tex.includes(":")) return false;
  try {
    katex.renderToString(tex, { throwOnError: true });
    return true;
  } catch {
    return false;
  }
}

// Removes any `$`/`$$` characters left over after every complete matched
// pair has been accounted for — i.e. orphan delimiters that would otherwise
// render as stray literal text (remark-math and MathText's own MATH_PATTERN
// both silently no-op on unmatched delimiters). Legitimate matched math
// spans are left byte-for-byte untouched; a "match" that's actually two
// bridged orphans (see looksLikeRealMath) has its delimiters stripped too,
// falling back to plain text rather than rendering nonsense math.
export function stripOrphanMathDelimiters(text: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(MATH_PATTERN)) {
    const index = match.index ?? 0;
    const tex = match[1] ?? match[2] ?? "";
    result += text.slice(lastIndex, index).replace(/\${1,2}/g, "");
    result += looksLikeRealMath(tex) ? match[0] : tex.replace(/\${1,2}/g, "");
    lastIndex = index + match[0].length;
  }
  result += text.slice(lastIndex).replace(/\${1,2}/g, "");
  return result;
}

export function sanitizeNotesContent(content: NotesContent): NotesContent {
  return { markdown: stripOrphanMathDelimiters(content.markdown) };
}

export function sanitizeQuizContent(content: QuizContent): QuizContent {
  assertQuizContentShape(content);
  return {
    questions: content.questions.map((q) =>
      q.type === "mcq"
        ? {
            ...q,
            question: stripOrphanMathDelimiters(q.question),
            explanation: stripOrphanMathDelimiters(q.explanation),
            options: q.options.map(stripOrphanMathDelimiters),
          }
        : {
            ...q,
            question: stripOrphanMathDelimiters(q.question),
            explanation: stripOrphanMathDelimiters(q.explanation),
            modelAnswer: stripOrphanMathDelimiters(q.modelAnswer),
          }
    ),
  };
}

export function sanitizeFlashcardsContent(content: FlashcardsContent): FlashcardsContent {
  assertFlashcardsContentShape(content);
  return {
    cards: content.cards.map((c) => ({
      front: stripOrphanMathDelimiters(c.front),
      back: stripOrphanMathDelimiters(c.back),
    })),
  };
}
