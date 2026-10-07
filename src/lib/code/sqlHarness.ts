import type { ProcessResult, TestOutcome } from "./types";

// The SQL side of code exercises (see sqlRunner.ts for how it runs). Pure:
// splits the learner's SQL into statements, builds the script one test
// runs in a fresh in-memory SQLite database, reads the sqlite3 shell's JSON
// output back, and compares it with what a test expects.
//
// A test's `code` is a JSON object:
//   { "expect": [[1, "Ada"], [2, "Grace"]],   rows, columns in order
//     "query": "SELECT …",                    optional — run AFTER the
//                                              learner's SQL, and its rows are
//                                              what's compared; without it the
//                                              learner's last statement is
//     "ordered": true,                        row order matters (default: no)
//     "columns": ["id", "name"] }             optional — column names to require

export const SQL_MARKER = "@@SB:";

// ---- Splitting SQL into statements ---------------------------------------

// Splits on the semicolons that end a statement, skipping those inside
// strings, quoted names, comments and CREATE TRIGGER bodies (which hold
// several statements, up to END). Statements keep their own text, without
// the trailing semicolon; empty ones are dropped.
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inTrigger = false;
  const flush = () => {
    if (hasSql(current)) statements.push(current.trim());
    current = "";
    inTrigger = false;
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          // A doubled quote is an escaped one.
          if (close !== "]" && sql[j + 1] === close) j += 2;
          else break;
        } else j++;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === ";") {
      if (inTrigger && !/\bEND\s*$/i.test(stripComments(current))) {
        current += c;
      } else {
        flush();
      }
      i++;
    } else {
      current += c;
      i++;
      if (!inTrigger && /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(current)) inTrigger = true;
    }
  }
  flush();
  return statements;
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasSql(text: string): boolean {
  return stripComments(text).trim().length > 0;
}

// The sqlite3 shell's own commands (.tables, .shell, .read …) aren't SQL;
// they're refused, so a learner's SQL can only do what SQL does.
export function findDotCommand(sql: string): string | null {
  for (const line of sql.split("\n")) {
    const m = /^\s*(\.[a-zA-Z]\w*)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

// ---- The script a test runs ----------------------------------------------

export interface SqlTest {
  expect: unknown[][];
  query: string | null;
  ordered: boolean;
  columns: string[] | null;
}

// Parses a test's JSON, or says what's wrong with it (a broken test is
// then ignored like any other the reference solution fails).
export function parseSqlTest(code: string): SqlTest | string {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return "The test isn't valid JSON.";
  }
  if (!raw || typeof raw !== "object") return "The test must be a JSON object.";
  const t = raw as Record<string, unknown>;
  if (!Array.isArray(t.expect) || !t.expect.every(Array.isArray)) return 'The test needs "expect": a list of rows.';
  if (t.query !== undefined && typeof t.query !== "string") return 'The test\'s "query" must be text.';
  if (t.columns !== undefined && !(Array.isArray(t.columns) && t.columns.every((c) => typeof c === "string"))) {
    return 'The test\'s "columns" must be a list of names.';
  }
  return {
    expect: t.expect as unknown[][],
    query: typeof t.query === "string" ? t.query : null,
    ordered: t.ordered === true,
    columns: Array.isArray(t.columns) ? (t.columns as string[]) : null,
  };
}

export const marker = (name: string) => `${SQL_MARKER}${name}@@`;

// One test's script. After the exercise's setup, each of the learner's
// statements is followed by a marker (so an empty result is told apart from
// a statement that returns nothing), then the test's own query, if any.
export function buildSqlScript(setup: string, statements: string[], testQuery: string | null): string {
  const lines = ["PRAGMA foreign_keys = ON;", setup.trim() ? `${setup.trim()}${setup.trim().endsWith(";") ? "" : ";"}` : "", `.print ${marker("setup")}`];
  statements.forEach((s, i) => lines.push(`${s};`, `.print ${marker(`stmt:${i}`)}`));
  if (testQuery !== null) lines.push(`${testQuery.trim().replace(/;\s*$/, "")};`, `.print ${marker("query")}`);
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

// ---- Reading the shell's output ------------------------------------------

export interface ResultSet {
  columns: string[];
  rows: unknown[][];
}

// The shell prints each statement's rows as a JSON array of objects. Column
// names can repeat (SELECT a.id, b.id) and JSON.parse would silently keep
// only the last, so this reads the objects itself, in order.
export function parseSqliteJson(text: string): ResultSet | null {
  const src = text.trim();
  if (!src) return null;
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const readString = (): string => {
    const start = i;
    i++; // opening quote
    while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
    i++; // closing quote
    return JSON.parse(src.slice(start, i)) as string;
  };
  const readValue = (): unknown => {
    ws();
    if (src[i] === '"') return readString();
    const start = i;
    while (i < src.length && !/[,}\]\s]/.test(src[i])) i++;
    return JSON.parse(src.slice(start, i));
  };
  try {
    ws();
    if (src[i++] !== "[") return null;
    const columns: string[] = [];
    const rows: unknown[][] = [];
    ws();
    while (i < src.length && src[i] !== "]") {
      if (src[i] === ",") {
        i++;
        ws();
        continue;
      }
      if (src[i++] !== "{") return null;
      const row: unknown[] = [];
      const names: string[] = [];
      ws();
      while (src[i] !== "}") {
        ws();
        names.push(readString());
        ws();
        if (src[i++] !== ":") return null;
        row.push(readValue());
        ws();
        if (src[i] === ",") i++;
        ws();
      }
      i++; // }
      if (columns.length === 0) columns.push(...names);
      rows.push(row);
      ws();
    }
    return { columns, rows };
  } catch {
    return null;
  }
}

export interface SqlRun {
  // The part of the output after each marker, in the order they appear.
  sections: Map<string, string>;
  // Which phase the output got to; the next one is where it stopped.
  reached: string[];
}

export function splitOutput(stdout: string): SqlRun {
  const sections = new Map<string, string>();
  const reached: string[] = [];
  const pattern = new RegExp(`${SQL_MARKER}([^@]+)@@\\n?`, "g");
  let last = 0;
  for (const m of stdout.matchAll(pattern)) {
    sections.set(m[1], stdout.slice(last, m.index));
    reached.push(m[1]);
    last = m.index + m[0].length;
  }
  return { sections, reached };
}

// What the shell said went wrong, without its "near line N of file" part.
export function cleanSqlError(stderr: string): string {
  const first = stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (first ?? "The SQL couldn't run.")
    .replace(/^(Parse error|Runtime error|Error)\s*(?:near line \d+(?: of \S+)?)?:?\s*/i, "")
    .slice(0, 500);
}

// ---- Comparing results ---------------------------------------------------

const TOLERANCE = 1e-6;

function sameValue(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" && typeof expected === "number") return Math.abs(actual - expected) <= TOLERANCE;
  return actual === expected;
}

function show(value: unknown): string {
  return value === null ? "NULL" : typeof value === "string" ? `'${value}'` : String(value);
}

const showRow = (row: unknown[]) => `(${row.map(show).join(", ")})`;

// A stable order for comparing rows when order doesn't matter.
function sortKey(row: unknown[]): string {
  return JSON.stringify(row.map((v) => (typeof v === "number" ? Number(v.toFixed(6)) : v)));
}

export function compareResult(result: ResultSet | null, test: SqlTest): string | null {
  const actual = result?.rows ?? [];
  if (test.columns && result) {
    const got = result.columns.map((c) => c.toLowerCase());
    const want = test.columns.map((c) => c.toLowerCase());
    if (got.length !== want.length || got.some((c, i) => c !== want[i])) {
      return `expected columns (${test.columns.join(", ")}), got (${result.columns.join(", ")})`;
    }
  }
  if (actual.length !== test.expect.length) {
    const preview = actual.slice(0, 3).map(showRow).join(", ");
    return `expected ${test.expect.length} row${test.expect.length === 1 ? "" : "s"}, got ${actual.length}${preview ? `: ${preview}${actual.length > 3 ? ", …" : ""}` : ""}`;
  }
  const wanted = test.ordered ? test.expect : [...test.expect].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const got = test.ordered ? actual : [...actual].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  for (let r = 0; r < wanted.length; r++) {
    const w = wanted[r];
    const g = got[r];
    if (w.length !== g.length || w.some((v, c) => !sameValue(g[c], v))) {
      return `row ${r + 1}${test.ordered ? "" : " (after sorting)"}: expected ${showRow(w)}, got ${showRow(g)}`;
    }
  }
  return null;
}

// A result set as plain aligned text, for the output panel.
export function formatTable(result: ResultSet | null, maxRows = 20): string {
  if (!result || result.columns.length === 0) return "";
  const cell = (v: unknown) => (v === null ? "NULL" : String(v));
  const shown = result.rows.slice(0, maxRows);
  const widths = result.columns.map((name, c) => Math.max(name.length, ...shown.map((r) => cell(r[c]).length)));
  const line = (cells: string[]) => cells.map((v, c) => v.padEnd(widths[c])).join(" | ").trimEnd();
  const out = [line(result.columns), widths.map((w) => "-".repeat(w)).join("-+-"), ...shown.map((r) => line(r.map(cell)))];
  if (result.rows.length > maxRows) out.push(`… ${result.rows.length - maxRows} more rows`);
  return out.join("\n");
}

// ---- One test's outcome ----------------------------------------------------

export interface SqlTestRun {
  process: ProcessResult;
  statementCount: number;
  test: SqlTest;
}

export function outcomeForSql(name: string, run: SqlTestRun): TestOutcome {
  const { process: p, statementCount, test } = run;
  if (p.timedOut) return { name, passed: false, message: "Took too long — is there a query that never ends?" };
  const out = splitOutput(p.stdout);
  if (p.exitCode !== 0) {
    // Failing before the setup finished is the exercise's fault, not the learner's.
    const who = out.reached.includes("setup") ? "Your SQL failed" : "The exercise's setup failed";
    return { name, passed: false, message: `${who}: ${cleanSqlError(p.stderr)}` };
  }
  const section = test.query !== null ? out.sections.get("query") : out.sections.get(`stmt:${statementCount - 1}`);
  if (section === undefined) return { name, passed: false, message: "Your SQL didn't run to the end." };
  // A statement with no rows prints nothing, which is an empty result.
  const message = compareResult(parseSqliteJson(section), test);
  return { name, passed: message === null, message };
}
