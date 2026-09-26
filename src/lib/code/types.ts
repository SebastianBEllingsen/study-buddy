// Shared, client-safe types for code exercises (lib/code/): programming
// practice where the learner's code is run against tests — in the browser,
// never on the server (see runner/).

export const CODE_LANGUAGES = ["python", "javascript"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const CODE_LANGUAGE_NAMES: Record<CodeLanguage, string> = {
  python: "Python",
  javascript: "JavaScript",
};

export function isCodeLanguage(value: unknown): value is CodeLanguage {
  return value === "python" || value === "javascript";
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

export interface CodeExercise {
  title: string;
  concept: string;
  // Markdown with $...$ math.
  prompt: string;
  starter: string;
  tests: CodeTest[];
  // A reference solution. The browser also runs it against the tests first
  // and ignores any test it fails, so a wrong AI-written test can't fail
  // the learner.
  solution: string;
  hints: string[];
}

export interface CodeProgress {
  // The learner's latest code.
  code: string;
  runs: number;
  hintsUsed: number;
  // Every (working) test passed at some point.
  passed: boolean;
  // Looked at the solution.
  revealed: boolean;
  done: boolean;
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

export function emptyCodeProgress(starter: string): CodeProgress {
  return { code: starter, runs: 0, hintsUsed: 0, passed: false, revealed: false, done: false };
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
}
