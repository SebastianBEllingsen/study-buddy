import { InvalidAiResponseError } from "../aiResponseValidation";
import { cleanConceptName } from "../conceptName";
import { parseProjectFiles } from "./projectFiles";
import { parseSqlTest } from "./sqlHarness";
import {
  EXERCISE_KINDS,
  PROJECT_LANGUAGES,
  REVIEW_POINT_KINDS,
  isRunKind,
  type CodeExercise,
  type CodeExerciseKind,
  type CodeLanguage,
  type CodeReview,
  type CodeTest,
  type ProjectFile,
  type ReviewPoint,
} from "./types";

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
  // SQL tests are JSON objects; the model may give one as an object or as text.
  const code = text(t.code !== null && typeof t.code === "object" ? JSON.stringify(t.code) : t.code, MAX_CODE).trim();
  if (!code) return null;
  return { name: text(t.name, 120).trim() || `Test ${index + 1}`, code, hidden: t.hidden === true };
}

const MAX_PROJECT_EXERCISE_FILES = 8;

// The exercise's tests: usable ones only, with unique names and at least one
// visible. (Results are matched to tests by name.)
function normalizeTests(raw: unknown, language: CodeLanguage): CodeTest[] {
  const tests = (Array.isArray(raw) ? raw : [])
    .slice(0, MAX_TESTS)
    .map(normalizeTest)
    .filter((t): t is CodeTest => t !== null)
    // A SQL test that isn't valid JSON would only ever fail.
    .filter((t) => language !== "sql" || typeof parseSqlTest(t.code) !== "string");
  const seen = new Map<string, number>();
  for (const t of tests) {
    const n = (seen.get(t.name) ?? 0) + 1;
    seen.set(t.name, n);
    if (n > 1) t.name = `${t.name} (${n})`;
  }
  // At least one visible test, so the learner knows what's expected.
  if (tests.length > 0 && tests.every((t) => t.hidden)) tests[0] = { ...tests[0], hidden: false };
  return tests;
}

function exerciseKind(value: unknown): CodeExerciseKind {
  return EXERCISE_KINDS.find((k) => k === value) ?? "write";
}

// A test-run exercise (write / debug / refactor) needs a prompt, a
// reference solution and tests; an answered one (predict / read) needs the
// code to look at and the answer.
export function normalizeCodeExercises(language: CodeLanguage, raw: unknown): CodeExercise[] {
  const list = raw && typeof raw === "object" ? (raw as { exercises?: unknown }).exercises : undefined;
  if (!Array.isArray(list)) throw new InvalidAiResponseError("no exercises");
  const exercises: CodeExercise[] = [];
  for (const entry of list.slice(0, MAX_EXERCISES)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const kind = exerciseKind(e.kind);
    // A SQL result can't be predicted word for word; that kind doesn't suit it.
    if (language === "sql" && kind === "predict") continue;
    // Only languages that can build from several files take projects.
    if (kind === "project" && !PROJECT_LANGUAGES.includes(language)) continue;
    const prompt = text(e.prompt, 6000).trim();
    const starter = text(e.starter, MAX_CODE);
    const common = {
      kind,
      title: text(e.title, 120).trim() || `Exercise ${exercises.length + 1}`,
      concept: cleanConceptName(e.concept) ?? "",
      starter,
      files: [] as ProjectFile[],
      solutionFiles: [] as ProjectFile[],
      setup: text(e.setup, MAX_CODE).trim(),
      hints: (Array.isArray(e.hints) ? e.hints : [])
        .map((h) => text(h, 600).trim())
        .filter(Boolean)
        .slice(0, 4),
    };

    if (!isRunKind(kind)) {
      const answer = text(e.answer, 3000).trim();
      const defaultPrompt = kind === "predict" ? "What does this program print, exactly?" : "";
      if (!starter.trim() || !answer || !(prompt || defaultPrompt)) continue;
      exercises.push({ ...common, prompt: prompt || defaultPrompt, tests: [], solution: "", answer });
      continue;
    }

    if (kind === "project") {
      // A milestone: starter and reference files, and tests, in place of one starter and solution.
      const files = parseProjectFiles(language, e.files, MAX_PROJECT_EXERCISE_FILES);
      const solutionFiles = parseProjectFiles(language, e.solutionFiles, MAX_PROJECT_EXERCISE_FILES);
      const tests = normalizeTests(e.tests, language);
      if (!prompt || !files || !solutionFiles || tests.length === 0) continue;
      exercises.push({ ...common, starter: "", prompt, tests, solution: "", answer: "", files, solutionFiles });
      continue;
    }

    const solution = text(e.solution, MAX_CODE).trimEnd();
    const tests = normalizeTests(e.tests, language);
    if (!prompt || !solution.trim() || tests.length === 0) continue;
    // Debug and refactor start from code the learner has to read.
    if ((kind === "debug" || kind === "refactor") && !starter.trim()) continue;
    exercises.push({ ...common, prompt, tests, solution, answer: "" });
  }
  if (exercises.length === 0) throw new InvalidAiResponseError("no usable exercises");
  return exercises;
}

const MAX_REVIEW_POINTS = 5;
const VERDICTS: CodeReview["verdict"][] = ["great", "good", "needs_work"];

// Validates the AI's review of a solution. A review with no usable summary
// or points is rejected rather than shown empty.
export function normalizeReview(raw: unknown): CodeReview {
  if (!raw || typeof raw !== "object") throw new InvalidAiResponseError("no review");
  const r = raw as Record<string, unknown>;
  const summary = text(r.summary, 800).trim();
  const points: ReviewPoint[] = [];
  for (const p of (Array.isArray(r.points) ? r.points : []).slice(0, MAX_REVIEW_POINTS)) {
    if (!p || typeof p !== "object") continue;
    const { kind, text: body } = p as Record<string, unknown>;
    const t = text(body, 600).trim();
    if (!t) continue;
    points.push({ kind: REVIEW_POINT_KINDS.find((k) => k === kind) ?? "style", text: t });
  }
  if (!summary && points.length === 0) throw new InvalidAiResponseError("empty review");
  let verdict = VERDICTS.find((v) => v === r.verdict) ?? (points.length > 0 ? "good" : "great");
  // "Great" with points listed contradicts itself; "needs work" with nothing to say is unfounded.
  if (verdict === "great" && points.length > 0) verdict = "good";
  if (verdict === "needs_work" && points.length === 0) verdict = "good";
  return { verdict, summary: summary || "Here is what stood out.", points };
}
