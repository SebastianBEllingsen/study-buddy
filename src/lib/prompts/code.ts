import { CODE_LANGUAGE_NAMES, type CodeLanguage } from "../code/types";

// Writing code exercises (lib/code/). The tests the model writes are run in
// the learner's browser against their code — and against the model's own
// reference solution first, so broken tests are caught.

export interface CodeTopic {
  name: string;
  summary: string;
  subtopics: string[];
}

const TEST_STYLE: Record<CodeLanguage, string> = {
  python: `Each test is Python code run after the learner's code, in the same module scope: plain \`assert\` statements, each with a message, e.g. \`assert add(2, 3) == 5, "add(2, 3) should be 5"\`. No input(), files or network, and no randomness without a fixed seed.`,
  javascript: `Each test is JavaScript run after the learner's code, in the same scope: calls to \`assert(condition, "message")\` or \`assert.equal(actual, expected, "message")\` (deep equality). Plain JavaScript — no imports, DOM, network, or timers.`,
};

// What a Python exercise may import: the standard library, plus the numerical
// packages the runner downloads on demand (lib/code/workerSource.ts). Their
// results are floats, so tests compare with a tolerance.
const PYTHON_LIBRARIES = `This runs in Python with numpy, scipy, matplotlib and sympy available, which suits modelling, simulation and linear algebra topics — use them when the topic calls for it, and otherwise stay with the standard library. Tests on floating-point results compare with a tolerance (e.g. \`abs(a - b) < 1e-6\` or \`numpy.allclose\`), never \`==\`. A plot the learner's code draws is shown to them but is never tested: tests check numbers and return values.

`;

export function codeExercisesSystemPrompt(
  courseName: string,
  topic: CodeTopic,
  language: CodeLanguage,
  proseLanguage: string,
  knownConcepts: string[]
): string {
  const name = CODE_LANGUAGE_NAMES[language];
  const outline = [
    topic.summary && `Summary: ${topic.summary}`,
    topic.subtopics.length && `Subtopics: ${topic.subtopics.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `You write programming exercises in ${name} for "${courseName}", on the topic "${topic.name}".${outline ? `\n${outline}` : ""}

${language === "python" ? PYTHON_LIBRARIES : ""}Write 4 exercises that build on each other, from a warm-up to one that needs real thought. Each asks the learner to write something testable — usually a function with a clear name and signature.

For each exercise:
- "title": a few words.
- "concept": the idea it practises (2–5 words${knownConcepts.length ? `; reuse one of these when it fits: ${knownConcepts.slice(0, 40).join("; ")}` : ""}).
- "prompt": what to write, in ${proseLanguage}, with the exact function name and signature, what it returns, and one example. Markdown; code in backticks.
- "starter": starter code — the signature with a placeholder body (e.g. \`pass\` / a TODO comment), no solution.
- "tests": 3–6 tests covering normal cases and edge cases. ${TEST_STYLE[language]} Give each a short "name" saying what it checks. Mark 1–2 simple ones "hidden": false and the rest "hidden": true.
- "solution": a clean, correct reference solution that passes every test. Double-check each test against it.
- "hints": 2–3 hints, from a gentle nudge to nearly the approach, in ${proseLanguage}, without code that gives the answer away.

Respond with ONLY a JSON object, no prose, no code fences:
{"exercises": [{"title": "...", "concept": "...", "prompt": "...", "starter": "...", "tests": [{"name": "...", "code": "...", "hidden": false}], "solution": "...", "hints": ["..."]}]}`;
}
