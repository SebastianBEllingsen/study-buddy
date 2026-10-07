import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onPath, runSandboxed, sandboxAvailable, withSlot } from "./sandbox";
import {
  CPP_FALLBACK_MAIN,
  CPP_FALLBACK_MAIN_FILE,
  CPP_USER_FILE,
  NO_MAIN_EXIT,
  SANITIZER_EXIT,
  buildCppProgram,
  formatDiagnostics,
  outcomeFor,
  parseDiagnostics,
  summarizeSanitizer,
} from "./cppHarness";
import { isHeader } from "./projectFiles";
import type { ProcessResult, ProjectFile, RunResult, TestOutcome } from "./types";

// Compiles and runs a learner's C++ on this machine — server side only,
// always inside the sandbox (see sandbox.ts for what that means).

const COMPILE_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 5_000;
const TOTAL_TEST_BUDGET_MS = 25_000;
const MAX_STDOUT_CHARS = 20_000;

const COMPILE_FLAGS = [
  "-std=c++20",
  "-Wall",
  "-Wextra",
  "-g",
  "-O0",
  "-fsanitize=address,undefined",
  "-fno-sanitize-recover=all",
  "-fno-omit-frame-pointer",
  "-D_GLIBCXX_ASSERTIONS",
  "-fdiagnostics-color=never",
  "-fmax-errors=10",
];

// Leaks and invalid memory use are the most useful things to catch while
// learning C++, so they're on; the RSS and allocation caps stop a runaway.
const SANITIZER_ENV = [
  `ASAN_OPTIONS=detect_leaks=1:exitcode=${SANITIZER_EXIT}:hard_rss_limit_mb=700:max_allocation_size_mb=256:print_summary=1`,
  `UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1:exitcode=${SANITIZER_EXIT}`,
];

export const TOOLCHAIN_MISSING =
  "Running C++ needs g++ and bubblewrap (bwrap) installed on this computer, and neither could be found.";

export function cppToolchainAvailable(): boolean {
  return sandboxAvailable() && onPath("g++");
}

const sandboxed = (workDir: string, command: string[], timeoutMs: number) =>
  runSandboxed(workDir, command, timeoutMs, { env: SANITIZER_ENV });

interface IndexedTest {
  index: number;
  name: string;
  code: string;
}

// What's being built: one pasted-in file, or a project's files.
type Source = { code: string } | { files: ProjectFile[] };

function isUserFile(source: Source, file: string): boolean {
  return "code" in source ? file === CPP_USER_FILE : source.files.some((f) => f.name === file);
}

async function compile(workDir: string, source: Source, tests: IndexedTest[], output: string): Promise<ProcessResult> {
  let program: string;
  let sources: string[] = [];
  if ("code" in source) {
    program = buildCppProgram(source.code, tests);
  } else {
    for (const file of source.files) await writeFile(join(workDir, file.name), file.content);
    program = buildCppProgram({ headers: source.files.filter((f) => isHeader(f.name)).map((f) => f.name) }, tests);
    sources = source.files.filter((f) => !isHeader(f.name)).map((f) => f.name);
  }
  await writeFile(join(workDir, `${output}.cpp`), program);
  await writeFile(join(workDir, CPP_FALLBACK_MAIN_FILE), CPP_FALLBACK_MAIN);
  return sandboxed(
    workDir,
    ["g++", ...COMPILE_FLAGS, `${output}.cpp`, ...sources, CPP_FALLBACK_MAIN_FILE, "-o", output],
    COMPILE_TIMEOUT_MS
  );
}

function failedAll(tests: IndexedTest[], message: string): TestOutcome[] {
  return tests.map((t) => ({ name: t.name, passed: false, message }));
}

// Compiler warnings in the learner's own code, shown even when it builds.
function warningsFor(source: Source, stderr: string): string | undefined {
  const text = formatDiagnostics(parseDiagnostics(stderr).filter((d) => isUserFile(source, d.file) && d.severity === "warning"));
  return text || undefined;
}

async function runTestProcesses(workDir: string, program: string, tests: IndexedTest[]): Promise<TestOutcome[]> {
  const outcomes: TestOutcome[] = [];
  const deadline = Date.now() + TOTAL_TEST_BUDGET_MS;
  for (const test of tests) {
    if (Date.now() > deadline) {
      outcomes.push({ name: test.name, passed: false, message: "Skipped: the run took too long overall." });
      continue;
    }
    outcomes.push(outcomeFor(test.name, await sandboxed(workDir, [`./${program}`, "test", String(test.index)], TEST_TIMEOUT_MS)));
  }
  return outcomes;
}

async function execute(workDir: string, source: Source, tests: IndexedTest[]): Promise<RunResult> {
  const built = await compile(workDir, source, tests, "prog");
  if (built.timedOut) {
    const message = "Compiling took too long.";
    return { stdout: "", error: message, tests: failedAll(tests, message) };
  }

  if (built.exitCode === 0) {
    const main = await sandboxed(workDir, ["./prog"], TEST_TIMEOUT_MS);
    const tested = await runTestProcesses(workDir, "prog", tests);
    return {
      stdout: mainOutput(main),
      error: null,
      tests: tested,
      ...(warningsFor(source, built.stderr) && { diagnostics: warningsFor(source, built.stderr) }),
    };
  }

  const diagnostics = parseDiagnostics(built.stderr);
  const yours = diagnostics.filter((d) => isUserFile(source, d.file) && d.severity === "error");
  if (yours.length > 0) {
    const error = formatDiagnostics(yours);
    return { stdout: "", error, tests: failedAll(tests, "Your code didn't compile — see the error above.") };
  }
  // Declared but never defined (or its source file missing from the project):
  // the compiler is happy, the linker isn't. No file or line to point at.
  const unresolved = [...built.stderr.matchAll(/undefined reference to `([^']+)'/g)].map((m) => m[1]);
  if (diagnostics.length === 0 && unresolved.length > 0) {
    const names = [...new Set(unresolved)].slice(0, 5).map((n) => `\`${n}\``).join(", ");
    const error = `Your code didn't link: ${names} ${unresolved.length === 1 ? "is" : "are"} declared but never defined (is a source file missing, or a function body?).`;
    return { stdout: "", error, tests: failedAll(tests, "Your code didn't link — see the error above.") };
  }
  if (diagnostics.length === 0 && built.stderr.trim()) {
    // Not a source error at all (the compiler itself failed to start, ran out
    // of resources, …).
    const error = built.stderr.trim().slice(0, 1500);
    return { stdout: "", error, tests: failedAll(tests, "The code couldn't be built here.") };
  }

  // The learner's code is fine: the trouble is in the tests (or a test calls
  // something the code doesn't define). Build each test on its own, so one
  // that doesn't compile fails alone — and a test the reference solution
  // can't build is then ignored, like any other broken test.
  const outcomes: TestOutcome[] = [];
  const runnable: IndexedTest[] = [];
  for (const test of tests) {
    const alone = await compile(workDir, source, [test], `prog_${test.index}`);
    if (alone.exitCode === 0) {
      runnable.push(test);
      continue;
    }
    const why = formatDiagnostics(parseDiagnostics(alone.stderr).filter((d) => d.severity === "error")) || alone.stderr;
    outcomes.push({
      name: test.name,
      passed: false,
      message: `This test couldn't be built: ${firstLine(why)}`.slice(0, 400),
    });
  }
  for (const test of runnable) {
    outcomes.push(outcomeFor(test.name, await sandboxed(workDir, [`./prog_${test.index}`, "test", String(test.index)], TEST_TIMEOUT_MS)));
  }
  const byName = new Map(outcomes.map((o) => [o.name, o]));
  const main = runnable.length > 0 ? await sandboxed(workDir, [`./prog_${runnable[0].index}`], TEST_TIMEOUT_MS) : null;
  return { stdout: main ? mainOutput(main) : "", error: null, tests: tests.map((t) => byName.get(t.name)!) };
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "unknown error"
  );
}

// What the learner's own main() printed, plus a note when it didn't finish cleanly.
function mainOutput(run: ProcessResult): string {
  if (run.exitCode === NO_MAIN_EXIT) return "";
  let out = run.stdout.slice(0, MAX_STDOUT_CHARS);
  if (run.timedOut) out += "\n[your program ran too long and was stopped]";
  else if (run.signal) out += `\n[your program was stopped by ${run.signal}]`;
  else if (run.exitCode === SANITIZER_EXIT || /Sanitizer|runtime error:/.test(run.stderr)) {
    out += `\n[${summarizeSanitizer(run.stderr)}]`;
  } else if (run.exitCode !== 0 && run.exitCode !== null) out += `\n[your program exited with code ${run.exitCode}]`;
  return out;
}

export async function runCppTests(input: string | ProjectFile[], tests: { name: string; code: string }[]): Promise<RunResult> {
  const source: Source = typeof input === "string" ? { code: input } : { files: input };
  const indexed = tests.map((t, index) => ({ ...t, index }));
  if (!cppToolchainAvailable()) return { stdout: "", error: TOOLCHAIN_MISSING, tests: failedAll(indexed, TOOLCHAIN_MISSING) };
  return withSlot(async () => {
    const workDir = await mkdtemp(join(tmpdir(), "study-buddy-cpp-"));
    try {
      return await execute(workDir, source, indexed);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}

