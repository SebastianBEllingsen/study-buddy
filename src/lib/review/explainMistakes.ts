import { generateStructured } from "../aiClient";
import { getAppSettings } from "../models";
import { languageName } from "../languages";
import { InvalidAiResponseError } from "../aiResponseValidation";
import { mistakeLabelSystemPrompt, mistakeLabelUserPrompt } from "../prompts/mistakes";
import { listMistakes, setMisconceptions, setMistakeTypes } from "./mistakes";
import { parseMistakeType, type MistakeType } from "./mistakeTypes";

// "Explain my mistakes": labels open mistakes that don't have a misconception
// note and a type yet, a batch per AI call. A mistake that already has a note
// keeps it: only the missing type is filled in.

export const MISTAKE_BATCH_SIZE = 20;
const MAX_LABEL_CHARS = 300;

// Validates the model's answer: labels for 1..count, one sentence each.
export function normalizeMistakeLabels(raw: unknown, count: number): Map<number, string> {
  const labels = (raw as { labels?: unknown })?.labels;
  if (!Array.isArray(labels)) throw new InvalidAiResponseError("missing labels");
  const out = new Map<number, string>();
  for (const entry of labels) {
    const n = (entry as { n?: unknown })?.n;
    const text = (entry as { misconception?: unknown })?.misconception;
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > count || typeof text !== "string") continue;
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_CHARS);
    if (clean) out.set(n as number, clean);
  }
  return out;
}

// The kind of mistake the model gave for each numbered mistake; one it gave
// no valid type for is simply left out.
export function normalizeMistakeTypes(raw: unknown, count: number): Map<number, MistakeType> {
  const labels = (raw as { labels?: unknown })?.labels;
  const out = new Map<number, MistakeType>();
  if (!Array.isArray(labels)) return out;
  for (const entry of labels) {
    const n = (entry as { n?: unknown })?.n;
    const type = parseMistakeType((entry as { type?: unknown })?.type);
    if (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count && type) out.set(n as number, type);
  }
  return out;
}

export async function explainMistakes(courseId: number | null): Promise<{ labeled: number; remaining: number }> {
  const pending = (await listMistakes({ courseId, status: "open" })).filter((m) => !m.misconception || !m.error_type);
  const batch = pending.slice(0, MISTAKE_BATCH_SIZE);
  if (batch.length === 0) return { labeled: 0, remaining: 0 };

  const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
  const raw = await generateStructured<unknown>({
    system: mistakeLabelSystemPrompt(languageName(preferredLanguage)),
    user: mistakeLabelUserPrompt(
      batch.map((m) => ({ prompt: m.prompt, correctAnswer: m.correct_answer, givenAnswer: m.given_answer }))
    ),
    maxTokens: 3000,
    effort: "low",
    efficient,
  });
  // Only what's missing is written: a note already there stays as it is.
  const notes = new Map<number, string>();
  for (const [n, text] of normalizeMistakeLabels(raw, batch.length)) {
    if (!batch[n - 1].misconception) notes.set(batch[n - 1].id, text);
  }
  const types = new Map<number, MistakeType>();
  for (const [n, type] of normalizeMistakeTypes(raw, batch.length)) {
    if (!batch[n - 1].error_type) types.set(batch[n - 1].id, type);
  }
  if (notes.size > 0) await setMisconceptions(notes);
  if (types.size > 0) await setMistakeTypes(types);

  const touched = new Set([...notes.keys(), ...types.keys()]);
  const complete = batch.filter((m) => (m.misconception || notes.has(m.id)) && (m.error_type || types.has(m.id))).length;
  return { labeled: touched.size, remaining: pending.length - complete };
}
