import { generateStructured } from "../aiClient";
import { getAppSettings } from "../models";
import { languageName } from "../languages";
import { InvalidAiResponseError } from "../aiResponseValidation";
import { mistakeLabelSystemPrompt, mistakeLabelUserPrompt } from "../prompts/mistakes";
import { listMistakes, setMisconceptions } from "./mistakes";

// "Explain my mistakes": labels open mistakes that don't have a
// misconception note yet, a batch per AI call.

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

export async function explainMistakes(courseId: number | null): Promise<{ labeled: number; remaining: number }> {
  const unlabeled = (await listMistakes({ courseId, status: "open" })).filter((m) => !m.misconception);
  const batch = unlabeled.slice(0, MISTAKE_BATCH_SIZE);
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
  const labels = normalizeMistakeLabels(raw, batch.length);
  const byId = new Map<number, string>();
  for (const [n, text] of labels) byId.set(batch[n - 1].id, text);
  await setMisconceptions(byId);
  return { labeled: byId.size, remaining: unlabeled.length - byId.size };
}
