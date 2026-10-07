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
  csharp: `Each test is the BODY of a C# static method (statements only — no using directives, no method definition), compiled after the learner's code with System, System.Collections.Generic, System.Linq and System.IO in scope, so it can call the learner's types directly (always name the class the learner must write, e.g. "write a public static class Calc with a static method Add"). Use these checks, which report a clear message on failure: \`CheckTrue(condition, "message")\`, \`CheckEqual(actual, expected)\` (works for numbers, strings, bools, arrays, lists and dictionaries, compared by value), \`CheckNear(actual, expected, tolerance)\` for floating point, and \`CheckThrows(() => expression)\`. To test a program that reads Console.In and prints with Console.WriteLine, write the exercise around a static Main and use \`string output = RunMain("input text\\n");\` then \`CheckEqual(output, "expected output")\`. Each test runs in its own process. No files, network, threads, or randomness without a fixed seed.`,
  sql: `Each test's "code" is a JSON OBJECT (not a string): {"expect": [[1, "Ada"], [2, "Grace"]], "ordered": false}. "expect" is the rows the result must have, each row a list of values in column order (numbers as numbers, text as strings, NULL as null). The result checked is the rows of the learner's LAST statement, or — when the exercise changes data, a table or an index — the rows of an extra "query" you give in the test, run after the learner's SQL (e.g. {"query": "SELECT count(*) FROM orders", "expect": [[3]]}). Set "ordered": true only when the exercise asks for an ORDER BY; otherwise row order is ignored. You may add "columns": ["name", "total"] to require column names (ask for them with AS aliases in the prompt). Floating-point values are compared with a tolerance.`,
  cpp: `Each test is the BODY of a C++20 function (statements only — no #include, no function definition), compiled after the learner's code with \`using namespace std;\` in scope, so it can call the learner's functions and use the standard library directly. Use these checks, which report a clear message on failure: \`CHECK(condition, "message")\`, \`CHECK_EQ(actual, expected)\` (works for numbers, strings, bools, vectors, pairs), \`CHECK_NEAR(actual, expected, tolerance)\` for floating point, and \`CHECK_THROWS(expression)\`. To test a program that reads std::cin and prints to std::cout, write the exercise around a main() and use \`std::string out = run_main("input text\\n");\` then \`CHECK_EQ(out, "expected output")\`. Each test runs in its own process under AddressSanitizer and UndefinedBehaviorSanitizer, so leaks, out-of-bounds access and undefined behaviour fail it. No files, network, threads or randomness without a fixed seed.`,
  python: `Each test is Python code run after the learner's code, in the same module scope: plain \`assert\` statements, each with a message, e.g. \`assert add(2, 3) == 5, "add(2, 3) should be 5"\`. No input(), files or network, and no randomness without a fixed seed.`,
  javascript: `Each test is JavaScript run after the learner's code, in the same scope: calls to \`assert(condition, "message")\` or \`assert.equal(actual, expected, "message")\` (deep equality). Plain JavaScript — no imports, DOM, network, or timers.`,
};

// What a Python exercise may import: the standard library, plus the numerical
// packages the runner downloads on demand (lib/code/workerSource.ts). Their
// results are floats, so tests compare with a tolerance.
const PYTHON_LIBRARIES = `This runs in Python with numpy, scipy, matplotlib and sympy available, which suits modelling, simulation and linear algebra topics — use them when the topic calls for it, and otherwise stay with the standard library. Tests on floating-point results compare with a tolerance (e.g. \`abs(a - b) < 1e-6\` or \`numpy.allclose\`), never \`==\`. A plot the learner's code draws is shown to them but is never tested: tests check numbers and return values.

`;

// What a C# exercise should and shouldn't be.
const CSHARP_NOTES = `Write modern C# (latest language version, nullable reference types on) in the style of the .NET design guidelines: PascalCase public members, camelCase locals, small methods, LINQ where it reads better than a loop, records and pattern matching where they fit, \`using\`/IDisposable for resources, and no needless nulls. Put code in classes with static methods (tests call types by name, so always name the class the learner must write), and give a static Main only when the exercise is a program that reads and prints; avoid top-level statements. Starter code and the reference solution must compile cleanly (no warnings). For memory topics (value vs reference types, boxing, IDisposable, span, GC) make the common mistake show up in a test.

`;

// What a SQL exercise should and shouldn't be.
const SQL_NOTES = `This is SQLite SQL (a recent version: window functions, CTEs, RETURNING and RIGHT/FULL JOIN are available). Every exercise needs a "setup": the CREATE TABLE and INSERT statements the exercise runs on (with PRIMARY KEY, FOREIGN KEY, UNIQUE and CHECK constraints where the topic is relational design), 4–12 rows of realistic data, a few tables when the topic is joins or relations. The setup is shown to the learner and is run fresh before their SQL and before each test. The learner's "starter" is a short comment and the start of a query, not the answer. Teach real database thinking: keys and relations, joins, grouping, subqueries and CTEs, NULL behaviour, normalisation, indexes (checked through sqlite_master or EXPLAIN QUERY PLAN), constraints and transactions (checked by a follow-up query). Use the kinds "write", "debug", "refactor" and "read" — never "predict" — and for "read" the "starter" is the SQL to read, the "answer" a model answer, and a "setup" is still given.

`;

// What a C++ exercise should and shouldn't be.
const CPP_NOTES = `Write modern C++20 in the style of the C++ Core Guidelines: std::vector and std::string over raw arrays, references over pointers where ownership isn't involved, smart pointers (never raw new/delete) when it is, const where it applies. Exercises are normally functions with a clear signature; for the first topics (output, input, control flow) a small program with main() that reads std::cin and prints is fine. The reference solution must compile cleanly with -Wall -Wextra, and tests must not depend on memory addresses or implementation-defined behaviour. Where the topic is ownership or memory, write exercises where the common mistake (a leak, a dangling reference) is caught by the sanitizers.

`;

// Guidance specific to one language, ahead of the exercise instructions.
const LANGUAGE_NOTES: Record<CodeLanguage, string> = {
  python: PYTHON_LIBRARIES,
  javascript: "",
  cpp: CPP_NOTES,
  csharp: CSHARP_NOTES,
  sql: SQL_NOTES,
};

export function codeExercisesSystemPrompt(
  courseName: string,
  topic: CodeTopic,
  language: CodeLanguage,
  proseLanguage: string,
  knownConcepts: string[],
  count = 4
): string {
  const name = CODE_LANGUAGE_NAMES[language];
  const outline = [
    topic.summary && `Summary: ${topic.summary}`,
    topic.subtopics.length && `Subtopics: ${topic.subtopics.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `You write programming exercises in ${name} for "${courseName}", on the topic "${topic.name}".${outline ? `\n${outline}` : ""}

${LANGUAGE_NOTES[language]}${count === 1 ? "Write 1 exercise that needs real thought." : `Write ${count} exercises that build on each other, from a warm-up to one that needs real thought.`} Each asks the learner to write something testable — usually a function with a clear name and signature.

For each exercise:
- "title": a few words.
- "concept": the idea it practises (2–5 words${knownConcepts.length ? `; reuse one of these when it fits: ${knownConcepts.slice(0, 40).join("; ")}` : ""}).
- "prompt": what to write, in ${proseLanguage}, with the exact function name and signature, what it returns, and one example. Markdown; code in backticks.
- "starter": starter code — the signature with a placeholder body (e.g. \`pass\` / a TODO comment), no solution.${language === "cpp" ? " Include the #include lines the solution needs (the learner's code must compile on its own), and give a signature with a stub body that compiles." : ""}${language === "csharp" ? " Include the using directives the solution needs (the learner's code must compile on its own), and give a class and signature with a stub body that compiles." : ""}
- "tests": 3–6 tests covering normal cases and edge cases. ${TEST_STYLE[language]} Give each a short "name" saying what it checks. Mark 1–2 simple ones "hidden": false and the rest "hidden": true.
- "solution": a clean, correct reference solution that passes every test. Double-check each test against it.${language === "sql" ? ' For SQL include "setup" as described, and a "solution" that is the SQL answer.' : ""}
- "hints": 2–3 hints, from a gentle nudge to nearly the approach, in ${proseLanguage}, without code that gives the answer away.

${KINDS}

Respond with ONLY a JSON object, no prose, no code fences:
{"exercises": [{"kind": "write", "title": "...", "concept": "...", "prompt": "...", "starter": "...", ${language === "sql" ? '"setup": "CREATE TABLE ...; INSERT ...;", ' : ""}"tests": [{"name": "...", "code": "...", "hidden": false}], "solution": "...", "hints": ["..."]}, {"kind": "predict", "title": "...", "concept": "...", "prompt": "...", "starter": "the code to read", "answer": "exact output", "hints": ["..."]}]}`;
}

// The exercise kinds the model may mix. Only "write" suits every topic.
const KINDS = `Each exercise has a "kind". Use "write" for most; mix in the others where they teach the topic better, and never use two of the same non-"write" kind in a row:
- "write": as above.
- "debug": "starter" is a short, realistic program or function with ONE bug related to the topic (an off-by-one, a missing case, a wrong comparison, an ownership mistake); the "prompt" says what it should do and what goes wrong, without naming the bug; "solution" is the fixed code; tests fail on the starter and pass on the solution.
- "refactor": "starter" works but is poorly written (duplication, unclear names, needless complexity); the "prompt" says what to improve; "solution" is a cleaner version; tests pass on both and must stay green.
- "predict": the learner reads "starter" (a short, complete program) and writes exactly what it prints. No tests and no solution: give "answer", the exact output (it is compared ignoring trailing whitespace), and choose code whose output needs real thought (evaluation order, copies vs references, integer division, scope, lifetime). Never rely on undefined behaviour.
- "read": the learner reads "starter" and answers the "prompt" question about it in their own words — what a function returns and why, who owns a piece of memory, how a value changes step by step, which function is called, what the contract is. No tests and no solution: give "answer", a model answer of one to four sentences.`;

export function codeReviewSystemPrompt(language: CodeLanguage, proseLanguage: string): string {
  return `You are a senior ${CODE_LANGUAGE_NAMES[language]} engineer reviewing a learner's solution to an exercise. It already passes its tests; your job is to teach them what the tests don't check, as a good code review would.

Judge: correctness beyond the tests (edge cases not covered), clarity and naming, needless complexity, ${language === "cpp" ? "ownership and lifetimes, const-correctness, raw new/delete, needless copies, undefined behaviour risks, " : ""}and whether it would be easy for someone else to read and change. A different valid approach from the reference is not a flaw; the reference is only there to compare against.

Write in ${proseLanguage}. Be specific — name the variable, line or construct — and kind but honest. At most 5 points, most important first; do not invent problems to fill space, and say what is good in the summary. Do not rewrite the whole solution.

Respond with ONLY a JSON object, no prose, no code fences:
{"verdict": "great" | "good" | "needs_work", "summary": "...", "points": [{"kind": "correctness" | "edge-case" | "readability" | "naming" | "simplicity" | "memory" | "style", "text": "..."}]}
- "great": nothing important to change (points empty). "good": it works, with small improvements worth making. "needs_work": it passes but has a real problem — fragile, leaky, wrong in a case the tests miss, or hard to follow.`;
}

// A multi-file project, built in milestones (C++ and C#): each milestone is
// an exercise with several files and tests, on the way to one working program.
export function codeProjectSystemPrompt(
  courseName: string,
  topic: CodeTopic,
  language: CodeLanguage,
  proseLanguage: string,
  count = 4
): string {
  const name = CODE_LANGUAGE_NAMES[language];
  const cpp = language === "cpp";
  const outline = [
    topic.summary && `Summary: ${topic.summary}`,
    topic.subtopics.length && `Subtopics: ${topic.subtopics.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `You design a small real ${name} PROJECT for "${courseName}", on the topic "${topic.name}", and break it into ${Math.max(2, count)} milestones the learner builds one after another.${outline ? `\n${outline}` : ""}

${cpp ? CPP_NOTES : CSHARP_NOTES}The project is one small program a person would actually want (an expression interpreter, a key-value store, a text-adventure engine, an inventory system, a tiny HTTP-style request router, a task scheduler …) chosen to fit the topic; at most 6 files, each under 120 lines. The learner needs to practise design, not only typing: milestone 1 fixes the structure — the files, class names and public signatures every later milestone keeps — and says so in its prompt.

Every exercise has "kind": "project" and:
- "title": "Milestone N: …".
- "concept": the idea it practises (2–5 words).
- "prompt": in ${proseLanguage}. First what the program is (briefly), then what THIS milestone adds, and name the exact files, ${cpp ? "classes and function signatures" : "classes and method signatures"} that tests call. Markdown.
- "files": the starter files for this milestone: the previous milestone's complete reference files, plus ${cpp ? "declarations in headers and empty or TODO function bodies in sources" : "classes with signatures and TODO bodies"} for the new work. For milestone 1: the skeleton. Every starter file must compile as it is (stubs may return placeholder values).
- "solutionFiles": the complete reference files at the end of this milestone. All tests must pass on them.
- "tests": 3–6 tests, 1–2 with "hidden": false. ${TEST_STYLE[language]} Tests use only the public interface the prompt names, never private details.
- "hints": 2–3 hints, from a nudge to nearly the approach, without giving the answer.
File "name"s are plain file names (no folders)${cpp ? " ending in .cpp or .hpp; every header starts with #pragma once and includes what it needs; one source file may define main() when the program has one" : " ending in .cs; no top-level statements; a static Main only when the program reads and prints"}. Later milestones may add files but must keep earlier names.

Respond with ONLY a JSON object, no prose, no code fences:
{"exercises": [{"kind": "project", "title": "...", "concept": "...", "prompt": "...", "files": [{"name": "...", "content": "..."}], "solutionFiles": [{"name": "...", "content": "..."}], "tests": [{"name": "...", "code": "...", "hidden": false}], "hints": ["..."]}]}`;
}
