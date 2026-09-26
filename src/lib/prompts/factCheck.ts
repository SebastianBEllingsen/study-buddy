import type { Checked, Flashcard, QuizQuestion } from "../types";
import { SOURCE_TRUST_RULE } from "./sources";

// The fact-check pass run on newly generated cards and questions
// (lib/sources/factCheck.ts): a second, independent read that flags items
// that are wrong, so they're held out of review until the student has
// looked at them. Deliberately conservative — a flagged item costs the
// student a decision, so only clear problems count.

export function factCheckSystemPrompt(courseName: string, language: string): string {
  return `You are a careful subject expert checking study items for the course "${courseName}" before a learner studies them.

Flag an item ONLY when it has a clear problem:
- a statement or answer that is factually wrong by well-established knowledge of the subject;
- it contradicts the authoritative material provided;
- the marked answer is not actually correct, or another option is also correct;
- the question is too ambiguous to answer as written.

Do NOT flag: style, difficulty, wording, simplifications acceptable at this level, or definitions and conventions that the authoritative material itself uses. When unsure, don't flag.
${SOURCE_TRUST_RULE}

For each flagged item, write "issue": one or two sentences in ${language} saying what is wrong and what is correct.

Respond with ONLY a JSON object, no prose, no code fences:
{ "issues": [ { "index": 0, "issue": "..." } ] }
Use an empty array when nothing needs flagging.`;
}

export function describeCard(card: Flashcard): string {
  return `Front: ${card.front}\nBack: ${card.back}`;
}

export function describeQuestion(q: QuizQuestion): string {
  if (q.type === "short_answer") {
    return `Question: ${q.question}\nModel answer: ${q.modelAnswer}\nExplanation: ${q.explanation}`;
  }
  const correct = q.type === "mcq" ? [q.correctIndex] : q.correctIndices;
  const options = q.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}${correct.includes(i) ? "  (marked correct)" : ""}`);
  return `Question: ${q.question}\nOptions:\n${options.join("\n")}\nExplanation: ${q.explanation}`;
}

export function factCheckUserPrompt(items: string[], material?: string): string {
  const listed = items.map((text, index) => `### Item ${index}\n${text}`).join("\n\n");
  const materialBlock = material
    ? `Course material the items were written from:\n\n${material}\n\n`
    : "The course material isn't included here — check against well-established knowledge of the subject.\n\n";
  return `${materialBlock}Items to check:\n\n${listed}\n\nCheck the items now.`;
}

export interface FactCheckIssue {
  index: number;
  issue: string;
}

// Keeps well-formed issues for items that exist, one per item.
export function parseFactCheck(raw: unknown, itemCount: number): FactCheckIssue[] {
  const list = raw && typeof raw === "object" ? (raw as { issues?: unknown }).issues : undefined;
  if (!Array.isArray(list)) return [];
  const seen = new Set<number>();
  const out: FactCheckIssue[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { index, issue } = entry as Record<string, unknown>;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= itemCount) continue;
    if (typeof issue !== "string" || !issue.trim() || seen.has(index as number)) continue;
    seen.add(index as number);
    out.push({ index: index as number, issue: issue.trim().slice(0, 500) });
  }
  return out;
}

// Marks items with a "check" flag from the issues found. Pure.
export function applyCheckFlags<T extends Checked>(items: T[], issues: FactCheckIssue[], at: string): T[] {
  const byIndex = new Map(issues.map((i) => [i.index, i.issue]));
  return items.map((item, index) => {
    const issue = byIndex.get(index);
    return issue && !item.flag ? { ...item, flag: { by: "check" as const, issue, at } } : item;
  });
}
