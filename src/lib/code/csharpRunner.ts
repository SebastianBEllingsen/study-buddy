import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NO_MAIN_EXIT, classifyTestRun } from "./cppHarness";
import {
  CSHARP_USER_FILE,
  buildCSharpHarness,
  explainCSharpError,
  formatCSharpDiagnostics,
  parseCSharpDiagnostics,
} from "./csharpHarness";
import { onPath, runSandboxed, sandboxAvailable, withSlot } from "./sandbox";
import type { ProcessResult, ProjectFile, RunResult, TestOutcome } from "./types";

// Compiles and runs a learner's C# on this machine — server side only,
// always inside the sandbox (see sandbox.ts).
//
// It calls the Roslyn compiler (csc.dll) from the installed .NET SDK
// directly rather than `dotnet build`: no project file, no NuGet restore (so
// no network), and about a second per compile. The program is the learner's
// file plus a generated harness file, run one test per process.

const COMPILE_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 8_000;
const TOTAL_TEST_BUDGET_MS = 30_000;
const MAX_STDOUT_CHARS = 20_000;

export const CSHARP_TOOLCHAIN_MISSING =
  "Running C# needs the .NET SDK and bubblewrap (bwrap) installed on this computer, and they couldn't be found.";

export interface DotnetToolchain {
  root: string;
  cscDll: string;
  refDir: string;
  // The runtime to run against, e.g. "10.0".
  tfm: string;
  frameworkVersion: string;
}

const versionParts = (v: string) => v.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
const newestFirst = (names: string[]) => [...names].sort((a, b) => compareVersions(b, a));
const subdirs = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

// Finds the SDK's compiler and the reference assemblies, newest first, using
// only a reference pack whose runtime is also installed (so what compiles can run).
let cached: DotnetToolchain | null | undefined;
export function findDotnet(): DotnetToolchain | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!onPath("dotnet")) return cached;
  const search = (process.env.PATH ?? "").split(":").concat(["/usr/sbin", "/usr/bin"]);
  const binary = search.map((d) => join(d, "dotnet")).find((p) => existsSync(p));
  if (!binary) return cached;
  const root = dirname(realpathSync(binary));
  const csc = newestFirst(subdirs(join(root, "sdk")))
    .map((v) => join(root, "sdk", v, "Roslyn", "bincore", "csc.dll"))
    .find((p) => existsSync(p));
  if (!csc) return cached;
  const runtimes = new Set(subdirs(join(root, "shared", "Microsoft.NETCore.App")));
  for (const version of newestFirst(subdirs(join(root, "packs", "Microsoft.NETCore.App.Ref")))) {
    const major = version.split(".")[0];
    const refDir = join(root, "packs", "Microsoft.NETCore.App.Ref", version, "ref", `net${major}.0`);
    if (!existsSync(refDir) || !runtimes.has(version)) continue;
    cached = { root, cscDll: csc, refDir, tfm: `net${major}.0`, frameworkVersion: `${major}.0.0` };
    break;
  }
  return cached;
}

export function csharpToolchainAvailable(): boolean {
  return sandboxAvailable() && findDotnet() !== null;
}

// Plain environment for the .NET tools: no telemetry or first-run work,
// no diagnostics sockets, culture-independent (so a missing ICU can't stop
// it), and a heap cap so a runaway allocation fails instead of eating RAM.
// W^X is off because its double-mapped memory is a file bigger than the
// sandbox's file-size limit, which makes the runtime abort at startup.
const DOTNET_ENV = [
  "DOTNET_EnableWriteXorExecute=0",
  "DOTNET_NOLOGO=1",
  "DOTNET_CLI_TELEMETRY_OPTOUT=1",
  "DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1",
  "DOTNET_EnableDiagnostics=0",
  "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1",
  "DOTNET_gcConcurrent=0",
  "DOTNET_GCHeapHardLimit=20000000",
];

function sandboxed(toolchain: DotnetToolchain, workDir: string, command: string[], timeoutMs: number) {
  return runSandboxed(workDir, command, timeoutMs, {
    env: [...DOTNET_ENV, `DOTNET_ROOT=${toolchain.root}`],
    // Only needed when .NET isn't under /usr (which is always mounted).
    readOnly: toolchain.root.startsWith("/usr/") ? [] : [toolchain.root],
  });
}

interface IndexedTest {
  index: number;
  name: string;
  code: string;
}

// What's being built: one file, or a project's files.
type Source = { code: string } | { files: ProjectFile[] };

const userFiles = (source: Source): ProjectFile[] => ("code" in source ? [{ name: CSHARP_USER_FILE, content: source.code }] : source.files);
const isUserFile = (source: Source, file: string) => userFiles(source).some((f) => f.name === file);

async function compile(toolchain: DotnetToolchain, workDir: string, source: Source, tests: IndexedTest[], output: string) {
  for (const file of userFiles(source)) await writeFile(join(workDir, file.name), file.content);
  await writeFile(join(workDir, "harness.cs"), buildCSharpHarness(tests));
  const references = readdirSync(toolchain.refDir).filter((f) => f.endsWith(".dll"));
  await writeFile(
    join(workDir, `${output}.rsp`),
    [
      "-nologo",
      "-nullable:enable",
      "-langversion:latest",
      "-warn:4",
      "-debug:portable",
      "-main:SbEntry",
      "-target:exe",
      `-out:${output}.dll`,
      ...references.map((f) => `-r:${join(toolchain.refDir, f)}`),
      ...userFiles(source).map((f) => f.name),
      "harness.cs",
    ].join("\n")
  );
  await writeFile(
    join(workDir, `${output}.runtimeconfig.json`),
    JSON.stringify({
      runtimeOptions: {
        tfm: toolchain.tfm,
        rollForward: "LatestMajor",
        framework: { name: "Microsoft.NETCore.App", version: toolchain.frameworkVersion },
      },
    })
  );
  return sandboxed(toolchain, workDir, ["dotnet", toolchain.cscDll, `@${output}.rsp`], COMPILE_TIMEOUT_MS);
}

const failedAll = (tests: { name: string }[], message: string): TestOutcome[] =>
  tests.map((t) => ({ name: t.name, passed: false, message }));

// A .NET stack overflow kills the process with a message but no catchable
// exception; say what it was.
function outcome(name: string, run: ProcessResult): TestOutcome {
  if (/Stack overflow/i.test(run.stderr)) return { name, passed: false, message: "Stack overflow — is there endless recursion?" };
  return { name, ...classifyTestRun(run) };
}

async function runTestProcesses(toolchain: DotnetToolchain, workDir: string, program: string, tests: IndexedTest[]) {
  const outcomes: TestOutcome[] = [];
  const deadline = Date.now() + TOTAL_TEST_BUDGET_MS;
  for (const test of tests) {
    if (Date.now() > deadline) {
      outcomes.push({ name: test.name, passed: false, message: "Skipped: the run took too long overall." });
      continue;
    }
    outcomes.push(
      outcome(test.name, await sandboxed(toolchain, workDir, ["dotnet", `${program}.dll`, "test", String(test.index)], TEST_TIMEOUT_MS))
    );
  }
  return outcomes;
}

// What the learner's own Main printed, plus a note when it didn't finish cleanly.
function mainOutput(run: ProcessResult): string {
  if (run.exitCode === NO_MAIN_EXIT) return "";
  let out = run.stdout.slice(0, MAX_STDOUT_CHARS);
  if (run.timedOut) out += "\n[your program ran too long and was stopped]";
  else if (/Stack overflow/i.test(run.stderr)) out += "\n[stack overflow — is there endless recursion?]";
  else if (/^Unhandled exception\./m.test(run.stderr)) {
    out += `\n[${run.stderr.split("\n").find((l) => /Unhandled exception\./.test(l))?.replace("Unhandled exception. ", "")}]`;
  } else if (run.exitCode !== 0 && run.exitCode !== null) out += `\n[your program exited with code ${run.exitCode}]`;
  return out;
}

async function execute(toolchain: DotnetToolchain, workDir: string, source: Source, tests: IndexedTest[]): Promise<RunResult> {
  const built = await compile(toolchain, workDir, source, tests, "prog");
  if (built.timedOut) {
    const message = "Compiling took too long.";
    return { stdout: "", error: message, tests: failedAll(tests, message) };
  }
  const diagnostics = parseCSharpDiagnostics(built.stdout + built.stderr);

  if (built.exitCode === 0) {
    const main = await sandboxed(toolchain, workDir, ["dotnet", "prog.dll"], TEST_TIMEOUT_MS);
    const warnings = formatCSharpDiagnostics(diagnostics.filter((d) => isUserFile(source, d.file) && d.severity === "warning"));
    return {
      stdout: mainOutput(main),
      error: null,
      tests: await runTestProcesses(toolchain, workDir, "prog", tests),
      ...(warnings && { diagnostics: warnings }),
    };
  }

  const yours = diagnostics.filter((d) => isUserFile(source, d.file) && d.severity === "error");
  const explained = explainCSharpError(diagnostics);
  if (yours.length > 0 || explained) {
    const error = explained ?? formatCSharpDiagnostics(yours);
    return { stdout: "", error, tests: failedAll(tests, "Your code didn't compile — see the error above.") };
  }
  if (diagnostics.length === 0) {
    const error = (built.stdout + built.stderr).trim().slice(0, 1500) || "The code couldn't be built here.";
    return { stdout: "", error, tests: failedAll(tests, "The code couldn't be built here.") };
  }

  // The learner's code is fine; a test doesn't compile (or calls something
  // undefined). Build each on its own so one fails alone — and a test the
  // reference solution can't build is then ignored like any other broken one.
  const outcomes = new Map<string, TestOutcome>();
  const runnable: IndexedTest[] = [];
  for (const test of tests) {
    const alone = await compile(toolchain, workDir, source, [test], `prog_${test.index}`);
    if (alone.exitCode === 0) {
      runnable.push(test);
      continue;
    }
    const why = formatCSharpDiagnostics(parseCSharpDiagnostics(alone.stdout + alone.stderr).filter((d) => d.severity === "error"));
    outcomes.set(test.name, {
      name: test.name,
      passed: false,
      message: `This test couldn't be built: ${why.split("\n")[0] ?? "unknown error"}`.slice(0, 400),
    });
  }
  for (const test of runnable) {
    const result = await sandboxed(toolchain, workDir, ["dotnet", `prog_${test.index}.dll`, "test", String(test.index)], TEST_TIMEOUT_MS);
    outcomes.set(test.name, outcome(test.name, result));
  }
  const main = runnable.length > 0 ? await sandboxed(toolchain, workDir, ["dotnet", `prog_${runnable[0].index}.dll`], TEST_TIMEOUT_MS) : null;
  return { stdout: main ? mainOutput(main) : "", error: null, tests: tests.map((t) => outcomes.get(t.name)!) };
}

export async function runCSharpTests(input: string | ProjectFile[], tests: { name: string; code: string }[]): Promise<RunResult> {
  const source: Source = typeof input === "string" ? { code: input } : { files: input };
  const indexed = tests.map((t, index) => ({ ...t, index }));
  const toolchain = findDotnet();
  if (!sandboxAvailable() || !toolchain) {
    return { stdout: "", error: CSHARP_TOOLCHAIN_MISSING, tests: failedAll(indexed, CSHARP_TOOLCHAIN_MISSING) };
  }
  return withSlot(async () => {
    const workDir = await mkdtemp(join(tmpdir(), "study-buddy-cs-"));
    try {
      return await execute(toolchain, workDir, source, indexed);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}
