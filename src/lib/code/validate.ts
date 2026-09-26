import { InvalidAiResponseError } from "../aiResponseValidation";
import { cleanConceptName } from "../conceptName";
import type { CodeExercise, CodeTest } from "./types";

// Validates the AI's code exercises. Pure.

const MAX_EXERCISES = 6;
const MAX_TESTS = 8;
const MAX_CODE = 8000;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").slice(0, max) : "";
}

function normalizeTest(raw: unknown, index: number): CodeTest | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const code = text(t.code, MAX_CODE).trim();
  if (!code) return null;
  return { name: text(t.name, 120).trim() || `Test ${index + 1}`, code, hidden: t.hidden === true };
}

export function normalizeCodeExercises(raw: unknown): CodeExercise[] {
  const list = raw && typeof raw === "object" ? (raw as { exercises?: unknown }).exercises : undefined;
  if (!Array.isArray(list)) throw new InvalidAiResponseError("no exercises");
  const exercises: CodeExercise[] = [];
  for (const entry of list.slice(0, MAX_EXERCISES)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const prompt = text(e.prompt, 6000).trim();
    const solution = text(e.solution, MAX_CODE).trimEnd();
    const tests = (Array.isArray(e.tests) ? e.tests : [])
      .slice(0, MAX_TESTS)
      .map(normalizeTest)
      .filter((t): t is CodeTest => t !== null);
    if (!prompt || !solution.trim() || tests.length === 0) continue;
    // Results are matched to tests by name, so names must be unique.
    const seen = new Map<string, number>();
    for (const t of tests) {
      const n = (seen.get(t.name) ?? 0) + 1;
      seen.set(t.name, n);
      if (n > 1) t.name = `${t.name} (${n})`;
    }
    // At least one visible test, so the learner knows what's expected.
    if (tests.every((t) => t.hidden)) tests[0] = { ...tests[0], hidden: false };
    exercises.push({
      title: text(e.title, 120).trim() || `Exercise ${exercises.length + 1}`,
      concept: cleanConceptName(e.concept) ?? "",
      prompt,
      starter: text(e.starter, MAX_CODE),
      tests,
      solution,
      hints: (Array.isArray(e.hints) ? e.hints : [])
        .map((h) => text(h, 600).trim())
        .filter(Boolean)
        .slice(0, 4),
    });
  }
  if (exercises.length === 0) throw new InvalidAiResponseError("no usable exercises");
  return exercises;
}
