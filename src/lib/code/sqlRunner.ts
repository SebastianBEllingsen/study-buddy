import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onPath, runSandboxed, sandboxAvailable, withSlot } from "./sandbox";
import {
  buildSqlScript,
  cleanSqlError,
  findDotCommand,
  formatTable,
  outcomeForSql,
  parseSqlTest,
  parseSqliteJson,
  splitOutput,
  splitStatements,
} from "./sqlHarness";
import type { RunResult, TestOutcome } from "./types";

// Runs a learner's SQL against SQLite on this machine — server side only,
// in the same sandbox as the C++ runner (sandbox.ts). Each test gets a fresh
// in-memory database built from the exercise's setup, so one test's writes
// can't affect another.

const RUN_TIMEOUT_MS = 8_000;
const MAX_STATEMENTS = 200;

export const SQL_TOOLCHAIN_MISSING =
  "Running SQL needs the sqlite3 command-line tool and bubblewrap (bwrap) installed on this computer, and they couldn't be found.";

export function sqlToolchainAvailable(): boolean {
  return sandboxAvailable() && onPath("sqlite3");
}

const sqlite = (workDir: string, script: string) =>
  runSandboxed(workDir, ["sqlite3", "-bail", "-json", ":memory:", `.read ${script}`], RUN_TIMEOUT_MS);

function failedAll(tests: { name: string }[], message: string): TestOutcome[] {
  return tests.map((t) => ({ name: t.name, passed: false, message }));
}

export async function runSqlTests(code: string, tests: { name: string; code: string }[], setup: string): Promise<RunResult> {
  if (!sqlToolchainAvailable()) return { stdout: "", error: SQL_TOOLCHAIN_MISSING, tests: failedAll(tests, SQL_TOOLCHAIN_MISSING) };
  const dot = findDotCommand(code);
  if (dot) {
    const error = `${dot} is a command of the sqlite3 shell, not SQL. Use plain SQL (e.g. SELECT name FROM sqlite_master to list tables).`;
    return { stdout: "", error, tests: failedAll(tests, error) };
  }
  const statements = splitStatements(code);
  if (statements.length === 0) {
    const error = "Write some SQL first.";
    return { stdout: "", error, tests: failedAll(tests, error) };
  }
  if (statements.length > MAX_STATEMENTS) {
    const error = `That's ${statements.length} statements; the limit is ${MAX_STATEMENTS}.`;
    return { stdout: "", error, tests: failedAll(tests, error) };
  }

  return withSlot(async () => {
    const workDir = await mkdtemp(join(tmpdir(), "study-buddy-sql-"));
    try {
      // First the learner's SQL on its own, for its own result and for any
      // error that stops it, so the error shows once instead of per test.
      await writeFile(join(workDir, "run.sql"), buildSqlScript(setup, statements, null));
      const own = await sqlite(workDir, "run.sql");
      const ownOutput = splitOutput(own.stdout);
      let error: string | null = null;
      if (own.timedOut) error = "Took too long — is there a query that never ends?";
      else if (own.exitCode !== 0) {
        error = `${ownOutput.reached.includes("setup") ? "" : "The exercise's setup failed: "}${cleanSqlError(own.stderr)}`;
      }
      const lastRows = statements.length > 0 ? ownOutput.sections.get(`stmt:${statements.length - 1}`) : undefined;
      const stdout = lastRows ? formatTable(parseSqliteJson(lastRows)) : "";
      if (error !== null) return { stdout, error, tests: failedAll(tests, "Your SQL didn't run — see the error above.") };

      const outcomes: TestOutcome[] = [];
      for (const [index, t] of tests.entries()) {
        const test = parseSqlTest(t.code);
        if (typeof test === "string") {
          outcomes.push({ name: t.name, passed: false, message: test });
          continue;
        }
        const file = `test_${index}.sql`;
        await writeFile(join(workDir, file), buildSqlScript(setup, statements, test.query));
        outcomes.push(outcomeForSql(t.name, { process: await sqlite(workDir, file), statementCount: statements.length, test }));
      }
      return { stdout, error: null, tests: outcomes };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}
