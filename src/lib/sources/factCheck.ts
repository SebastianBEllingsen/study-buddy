import { generateStructured } from "../aiClient";
import { estimateTokens } from "../chunking";
import { languageName } from "../languages";
import {
  describeCard,
  describeQuestion,
  factCheckSystemPrompt,
  factCheckUserPrompt,
  parseFactCheck,
  applyCheckFlags,
  type FactCheckIssue,
} from "../prompts/factCheck";
import type { FlashcardsContent, QuizContent } from "../types";

// Items per fact-check call — enough to keep calls few, small enough that
// the model gives each item real attention.
const BATCH = 30;

// The most material sent along with a check. Past this, the check leans on
// established knowledge instead of re-sending a whole course per call.
const MATERIAL_BUDGET_TOKENS = 60_000;

async function checkTexts(
  texts: string[],
  options: { courseName: string; material?: string; efficient?: boolean; language: string }
): Promise<FactCheckIssue[]> {
  // The material rides along only when it fits comfortably; otherwise the
  // check falls back to established knowledge of the subject.
  const material =
    options.material && estimateTokens(options.material) <= MATERIAL_BUDGET_TOKENS ? options.material : undefined;
  const issues: FactCheckIssue[] = [];
  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    const raw = await generateStructured<unknown>({
      system: factCheckSystemPrompt(options.courseName, languageName(options.language)),
      user: factCheckUserPrompt(batch, material),
      maxTokens: 3000,
      effort: options.efficient ? "low" : "medium",
      efficient: options.efficient,
    });
    for (const found of parseFactCheck(raw, batch.length)) issues.push({ ...found, index: found.index + start });
  }
  return issues;
}

// Runs the fact-check over newly generated cards or questions and flags
// what it finds. `fromIndex` skips items that were already there (a
// supplement only checks what it added). A failed check never fails the
// generation: the items come back unflagged and the error is logged.
export async function factCheckContent<C extends QuizContent | FlashcardsContent>(
  mode: "quiz" | "flashcards",
  content: C,
  options: { courseName: string; material?: string; efficient?: boolean; language: string; fromIndex?: number }
): Promise<C> {
  const from = options.fromIndex ?? 0;
  try {
    const at = new Date().toISOString();
    if (mode === "quiz") {
      const questions = (content as QuizContent).questions;
      const fresh = questions.slice(from);
      if (!fresh.length) return content;
      const issues = await checkTexts(fresh.map(describeQuestion), options);
      return { ...content, questions: [...questions.slice(0, from), ...applyCheckFlags(fresh, issues, at)] };
    }
    const cards = (content as FlashcardsContent).cards;
    const fresh = cards.slice(from);
    if (!fresh.length) return content;
    const issues = await checkTexts(fresh.map(describeCard), options);
    return { ...content, cards: [...cards.slice(0, from), ...applyCheckFlags(fresh, issues, at)] };
  } catch (err) {
    console.error("Fact-check failed; keeping the items unflagged:", err);
    return content;
  }
}
