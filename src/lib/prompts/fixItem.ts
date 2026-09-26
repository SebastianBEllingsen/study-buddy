import { InvalidAiResponseError } from "../aiResponseValidation";
import { cleanEntry, FlagError, type FlaggableEntry, type FlaggableMode } from "../sources/flags";
import { SOURCE_TRUST_RULE } from "./sources";
import { describeCard, describeQuestion } from "./factCheck";
import type { Flashcard, QuizQuestion } from "../types";

// "Fix with AI" for a flagged card or question: the model re-checks it
// against its source (when there is one) and either confirms it's right or
// proposes a corrected version. Nothing is saved until the student accepts.

export function fixItemSystemPrompt(courseName: string, mode: FlaggableMode, language: string): string {
  const shape =
    mode === "flashcards"
      ? '{ "front": "...", "back": "..." }'
      : 'the same shape and "type" as the original question, e.g. { "type": "mcq", "question": "...", "options": ["...", "..."], "correctIndex": 0, "explanation": "..." }';
  return `You are a careful subject expert fixing a study item for the course "${courseName}" that was reported as possibly wrong.

Decide whether the item is actually correct.
- If it is correct, say so and explain briefly why the report is mistaken.
- If it's wrong, ambiguous, or incomplete, write a corrected version. Keep it as close to the original as you can: same topic, same kind of item, only change what's needed.

${SOURCE_TRUST_RULE}
If no material is given, rely on well-established knowledge of the subject.

Write "note" (one or two sentences, in ${language}) explaining your decision. Write the item in the same language as the original. Use $...$ for inline math.

Respond with ONLY a JSON object, no prose, no code fences:
{ "verdict": "correct" | "fixed", "note": "...", "item": ${shape} }
Leave out "item" when the verdict is "correct".`;
}

export function fixItemUserPrompt(
  mode: FlaggableMode,
  entry: FlaggableEntry,
  issue: string,
  material?: string
): string {
  const item = mode === "flashcards" ? describeCard(entry as Flashcard) : describeQuestion(entry as QuizQuestion);
  const materialBlock = material ? `Source material:\n\n${material}\n\n` : "";
  return `${materialBlock}The item:\n${item}\n\nWhat was reported:\n${issue}\n\nCheck it now.`;
}

export type FixSuggestion =
  | { verdict: "correct"; note: string }
  | { verdict: "fixed"; note: string; item: FlaggableEntry };

export function normalizeFixSuggestion(raw: unknown, mode: FlaggableMode): FixSuggestion {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const note = typeof r.note === "string" ? r.note.trim().slice(0, 600) : "";
  if (r.verdict === "correct") return { verdict: "correct", note };
  if (r.verdict !== "fixed") throw new InvalidAiResponseError("The fix suggestion had no verdict.");
  try {
    return { verdict: "fixed", note, item: cleanEntry(mode, r.item) };
  } catch (err) {
    if (err instanceof FlagError) throw new InvalidAiResponseError("The suggested fix wasn't a complete item.");
    throw err;
  }
}
