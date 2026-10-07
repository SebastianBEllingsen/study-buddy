import { MAX_FILE_CHARS, MAX_PROJECT_FILES } from "./projectFiles";
import { PROJECT_LANGUAGES, isCodeLanguage, type CodeLanguage, type ProjectFile, type TestOutcome } from "./types";

// Request parsing for the code exercise routes. Pure.

const MAX_CODE_CHARS = 50_000;
export const DEFAULT_EXERCISE_COUNT = 4;
const MAX_TESTS = 20;
const MAX_ANSWER_CHARS = 5000;

export type CodeAction =
  // A project milestone sends its `files` as well; the service checks their
  // names against the set's language.
  | { action: "save"; exercise: number; code: string; files?: ProjectFile[] }
  | { action: "run"; exercise: number; code: string; files?: ProjectFile[]; error: string | null; tests: TestOutcome[] }
  // "predict" / "read" exercises: the answer, and for "read" — once the
  // learner has compared with the model answer — whether they got it.
  | { action: "answer"; exercise: number; answer: string; selfCorrect?: boolean }
  // Ask for the AI's review of a solved exercise.
  | { action: "review"; exercise: number }
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

// The shape of a project's files only: name and content as text, a sane count
// and size. Whether the names suit the language is checked where it's known.
function parseFilesShape(value: unknown): ProjectFile[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROJECT_FILES) return null;
  const files: ProjectFile[] = [];
  for (const f of value) {
    if (!f || typeof f !== "object") return null;
    const { name, content } = f as Record<string, unknown>;
    if (typeof name !== "string" || name.length > 80 || typeof content !== "string" || content.length > MAX_FILE_CHARS) return null;
    files.push({ name, content });
  }
  return files;
}

export function parseCodeAction(body: Record<string, unknown>): CodeAction | null {
  const exercise = body.exercise;
  if (!Number.isInteger(exercise) || (exercise as number) < 0) return null;
  const e = exercise as number;
  const files = parseFilesShape(body.files);
  if (files === null) return null;
  // A project sends files instead of code.
  const code = typeof body.code === "string" && body.code.length <= MAX_CODE_CHARS ? body.code : files ? "" : null;
  switch (body.action) {
    case "save":
      return code === null ? null : { action: "save", exercise: e, code, ...(files && { files }) };
    case "run": {
      const tests = parseOutcomes(body.tests);
      if (code === null || !tests) return null;
      const error = typeof body.error === "string" ? body.error.slice(0, 2000) : null;
      return { action: "run", exercise: e, code, ...(files && { files }), error, tests };
    }
    case "answer": {
      const answer = typeof body.answer === "string" && body.answer.length <= MAX_ANSWER_CHARS ? body.answer : null;
      if (answer === null) return null;
      return { action: "answer", exercise: e, answer, ...(typeof body.selfCorrect === "boolean" && { selfCorrect: body.selfCorrect }) };
    }
    case "review":
      return { action: "review", exercise: e };
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
): { language: CodeLanguage; chapterId: number | null; topic: string; count: number; project: boolean } | null {
  if (!isCodeLanguage(body.language)) return null;
  const chapterId = body.chapterId == null ? null : Number.isInteger(body.chapterId) ? (body.chapterId as number) : undefined;
  if (chapterId === undefined) return null;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  if (chapterId === null && !topic) return null;
  // How many exercises: a full progression by default, fewer for a quick retry.
  const count = Number.isInteger(body.count) && (body.count as number) >= 1 && (body.count as number) <= 6 ? (body.count as number) : DEFAULT_EXERCISE_COUNT;
  // A multi-file project built in milestones, for the languages that can.
  const project = body.project === true && PROJECT_LANGUAGES.includes(body.language);
  return { language: body.language, chapterId, topic, count, project };
}
