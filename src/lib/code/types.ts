// Shared, client-safe types for code exercises (lib/code/): programming
// practice where the learner's code is run against tests — in the browser,
// never on the server (see runner/).

export const CODE_LANGUAGES = ["cpp", "csharp", "sql", "python", "javascript"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const CODE_LANGUAGE_NAMES: Record<CodeLanguage, string> = {
  cpp: "C++",
  csharp: "C#",
  sql: "SQL",
  python: "Python",
  javascript: "JavaScript",
};

// What CodeMirror calls each language, where that differs from its display name.
export const EDITOR_LANGUAGE_NAMES: Record<CodeLanguage, string> = {
  cpp: "C++",
  csharp: "C#",
  sql: "SQLite",
  python: "Python",
  javascript: "JavaScript",
};

// Languages whose code is compiled or run by the app's server, in a
// sandbox, rather than in the browser (see cppRunner.ts, csharpRunner.ts,
// sqlRunner.ts).
export const SERVER_RUN_LANGUAGES: readonly CodeLanguage[] = ["cpp", "csharp", "sql"];

export function runsOnServer(language: CodeLanguage): boolean {
  return SERVER_RUN_LANGUAGES.includes(language);
}

export function isCodeLanguage(value: unknown): value is CodeLanguage {
  return typeof value === "string" && (CODE_LANGUAGES as readonly string[]).includes(value);
}

export interface CodeTest {
  // Shown next to the result, e.g. "handles an empty list".
  name: string;
  // Run after the learner's code, in the same scope. Python: `assert`
  // statements. JavaScript: calls to assert(cond, message) or
  // assert.equal(actual, expected).
  code: string;
  // Hidden tests aren't displayed until the exercise is finished. They
  // still reach the browser, which runs them — this is practice, not an
  // exam anyone could cheat.
  hidden: boolean;
}

// What an exercise asks of the learner. The first three are run against
// tests; the last two are answered:
//  write    — write it from a blank page (or a signature)
//  debug    — the starter code is broken; find and fix the bug
//  refactor — the starter code works but is poor; improve it, tests stay green
//  predict  — read the code and say exactly what it prints
//  read     — read the code and answer a question about it (what does this
//             do, who owns this memory, trace this state, where is this
//             defined); compared with a model answer by the learner
//  project  — a milestone of a bigger program, written across several files
//             (C++ and C# only); run against tests like the first three
export const EXERCISE_KINDS = ["write", "debug", "refactor", "predict", "read", "project"] as const;
export type CodeExerciseKind = (typeof EXERCISE_KINDS)[number];

export const EXERCISE_KIND_LABELS: Record<CodeExerciseKind, string> = {
  write: "Write",
  debug: "Find the bug",
  refactor: "Refactor",
  predict: "Predict the output",
  read: "Read the code",
  project: "Project milestone",
};

export function isRunKind(kind: CodeExerciseKind): boolean {
  return kind === "write" || kind === "debug" || kind === "refactor" || kind === "project";
}

// A source file of a multi-file project.
export interface ProjectFile {
  name: string;
  content: string;
}

// Languages that can build a project from several files.
export const PROJECT_LANGUAGES: readonly CodeLanguage[] = ["cpp", "csharp"];

export interface CodeExercise {
  // Absent on exercises saved before there were kinds: those are "write".
  kind: CodeExerciseKind;
  title: string;
  concept: string;
  // Markdown with $...$ math.
  prompt: string;
  starter: string;
  // "project" exercises: the starter and reference files, instead of
  // `starter` and `solution` (which are empty). Empty on every other kind.
  files: ProjectFile[];
  solutionFiles: ProjectFile[];
  // SQL only: the schema and data the exercise runs on (CREATE TABLE …,
  // INSERT …), shown to the learner and run before their SQL. Empty otherwise.
  setup: string;
  tests: CodeTest[];
  // A reference solution. The runner also runs it against the tests first
  // and ignores any test it fails, so a wrong AI-written test can't fail
  // the learner. Empty on "predict" and "read" exercises.
  solution: string;
  // "predict": the exact output. "read": the model answer. Empty otherwise.
  answer: string;
  hints: string[];
}

export interface CodeProgress {
  // The learner's latest code.
  code: string;
  // "project" exercises: the learner's latest files.
  files: ProjectFile[];
  runs: number;
  hintsUsed: number;
  // Every (working) test passed at some point.
  passed: boolean;
  // Looked at the solution.
  revealed: boolean;
  done: boolean;
  // "predict" / "read": the learner's latest answer.
  answer: string;
  // The AI's review of a solved exercise, once asked for.
  review: CodeReview | null;
}

// Feedback on working code: what's good and what to improve, so "it passes"
// isn't the end of it.
export const REVIEW_POINT_KINDS = ["correctness", "edge-case", "readability", "naming", "simplicity", "memory", "style"] as const;
export type ReviewPointKind = (typeof REVIEW_POINT_KINDS)[number];

export interface ReviewPoint {
  kind: ReviewPointKind;
  text: string;
}

export interface CodeReview {
  // great: nothing important to change. good: works, small improvements.
  // needs_work: it passes, but has a real problem (fragile, leaky, unclear).
  verdict: "great" | "good" | "needs_work";
  summary: string;
  points: ReviewPoint[];
}

export interface CodeSet {
  id: number;
  course_id: number;
  chapter_id: number | null;
  title: string;
  language: CodeLanguage;
  exercises: CodeExercise[];
  progress: CodeProgress[];
  practice_item_id: number | null;
  created_at: string;
}

export function emptyCodeProgress(starter: string, files: ProjectFile[] = []): CodeProgress {
  return { code: starter, files, runs: 0, hintsUsed: 0, passed: false, revealed: false, done: false, answer: "", review: null };
}

// One test's outcome, from the browser runner.
export interface TestOutcome {
  name: string;
  passed: boolean;
  message: string | null;
}

export interface RunResult {
  // Output printed while the code ran.
  stdout: string;
  // An error that stopped the code itself from running (syntax error,
  // exception at the top level, timeout); null if it loaded fine.
  error: string | null;
  tests: TestOutcome[];
  // Figures the code drew (Python, matplotlib), as PNG data URLs.
  images?: string[];
  // Compiler warnings about the learner's code (C++), when it built anyway.
  diagnostics?: string;
}

// What a sandboxed compiler or program process left behind (server side).
export interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}
