import katex from "katex";
import type { Checked, NotesContent, QuizContent, FlashcardsContent } from "./types";
import { assertQuizContentShape, assertFlashcardsContentShape } from "./aiResponseValidation";
import { cleanConceptName } from "./conceptName";
import { withCheckedMeta } from "./sources/itemMeta";

// Keeps a usable `concept` tag, source and flag, and drops anything else
// under those keys.
function withConcept<T extends { concept?: unknown }>(item: T): T {
  const { concept, ...rest } = withCheckedMeta(item as T & Checked) as T;
  const name = cleanConceptName(concept);
  return (name ? { ...rest, concept: name } : rest) as T;
}

// Shared with MathText.tsx and NoteEditor.tsx's live in-editor concealment —
// the one definition of "what counts as a complete, matched math span," used
// for rendering, live-editor concealment, and stripping orphaned delimiters
// after generation. Groups 1/2 are this app's own $$.../$...$ convention
// (what every AI prompt in this app is told to emit); groups 3/4 are
// MathJax's \[...\]/\(...\) convention — never asked for by this app's own
// prompts, but common in raw Ctrl+A pastes from an LMS/course-portal page
// (MathJax's own default delimiters), which "Make pretty" preserves
// verbatim rather than rewriting notation. remark-math (the markdown
// renderer's own math plugin) only ever recognizes $/$$ , so consumers that
// feed a string to it still need normalizeLatexDelimiters below — this
// pattern alone only helps the two consumers that scan raw text themselves.
export const MATH_PATTERN =
  /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)/g;

// remark-math (used by every ReactMarkdown-based renderer in this app) only
// parses $.../$$...$$ — it has no option to also recognize MathJax's
// \[...\]/\(...\) delimiters. Converting them here, at render time, fixes
// pasted-from-the-web math without ever touching what's actually stored
// (the note/document keeps whatever delimiters were originally pasted).
export function normalizeLatexDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, inner: string) => `$$${inner}$$`)
    .replace(/\\\(([^\n]+?)\\\)/g, (_, inner: string) => `$${inner}$`);
}

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
    questions: content.questions.map((q) => {
      if (q.type === "mcq" || q.type === "multi_select") {
        return {
          ...withConcept(q),
          question: stripOrphanMathDelimiters(q.question),
          explanation: stripOrphanMathDelimiters(q.explanation),
          options: q.options.map(stripOrphanMathDelimiters),
        };
      }
      return {
        ...withConcept(q),
        question: stripOrphanMathDelimiters(q.question),
        explanation: stripOrphanMathDelimiters(q.explanation),
        modelAnswer: stripOrphanMathDelimiters(q.modelAnswer),
      };
    }),
  };
}

export function sanitizeFlashcardsContent(content: FlashcardsContent): FlashcardsContent {
  assertFlashcardsContentShape(content);
  return {
    cards: content.cards.map((c) => {
      const concept = cleanConceptName(c.concept);
      const { source, flag } = withCheckedMeta({ source: c.source, flag: c.flag });
      return {
        front: stripOrphanMathDelimiters(c.front),
        back: stripOrphanMathDelimiters(c.back),
        ...(concept && { concept }),
        ...(source && { source }),
        ...(flag && { flag }),
      };
    }),
  };
}
