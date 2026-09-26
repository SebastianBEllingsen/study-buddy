import { isCodeLanguage, type CodeLanguage, type TestOutcome } from "./types";

// Request parsing for the code exercise routes. Pure.

const MAX_CODE_CHARS = 50_000;
const MAX_TESTS = 20;

export type CodeAction =
  | { action: "save"; exercise: number; code: string }
  | { action: "run"; exercise: number; code: string; error: string | null; tests: TestOutcome[] }
  | { action: "hint"; exercise: number }
  | { action: "reveal"; exercise: number };

function parseOutcomes(value: unknown): TestOutcome[] | null {
  if (!Array.isArray(value) || value.length > MAX_TESTS) return null;
  const out: TestOutcome[] = [];
  for (const t of value) {
    if (!t || typeof t !== "object") return null;
    const { name, passed, message } = t as Record<string, unknown>;
    if (typeof name !== "string" || typeof passed !== "boolean") return null;
    out.push({ name: name.slice(0, 120), passed, message: typeof message === "string" ? message.slice(0, 1000) : null });
  }
  return out;
}

export function parseCodeAction(body: Record<string, unknown>): CodeAction | null {
  const exercise = body.exercise;
  if (!Number.isInteger(exercise) || (exercise as number) < 0) return null;
  const e = exercise as number;
  const code = typeof body.code === "string" && body.code.length <= MAX_CODE_CHARS ? body.code : null;
  switch (body.action) {
    case "save":
      return code === null ? null : { action: "save", exercise: e, code };
    case "run": {
      const tests = parseOutcomes(body.tests);
      if (code === null || !tests) return null;
      const error = typeof body.error === "string" ? body.error.slice(0, 2000) : null;
      return { action: "run", exercise: e, code, error, tests };
    }
    case "hint":
      return { action: "hint", exercise: e };
    case "reveal":
      return { action: "reveal", exercise: e };
    default:
      return null;
  }
}

export function parseNewCodeSet(
  body: Record<string, unknown>
): { language: CodeLanguage; chapterId: number | null; topic: string } | null {
  if (!isCodeLanguage(body.language)) return null;
  const chapterId = body.chapterId == null ? null : Number.isInteger(body.chapterId) ? (body.chapterId as number) : undefined;
  if (chapterId === undefined) return null;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (chapterId === null && !topic) return null;
  return { language: body.language, chapterId, topic };
}
