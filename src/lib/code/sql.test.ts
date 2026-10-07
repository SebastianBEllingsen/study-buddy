import { describe, expect, it } from "vitest";
import {
  buildSqlScript,
  cleanSqlError,
  compareResult,
  findDotCommand,
  formatTable,
  parseSqlTest,
  parseSqliteJson,
  splitOutput,
  splitStatements,
} from "./sqlHarness";

describe("splitStatements", () => {
  it("splits on semicolons, not on those inside strings, names or comments", () => {
    expect(
      splitStatements(`SELECT 'a;b' AS x; -- end; of line
SELECT "c;d" FROM t; /* a; b */ SELECT 3;`)
    ).toEqual(["SELECT 'a;b' AS x", "-- end; of line\nSELECT \"c;d\" FROM t", "/* a; b */ SELECT 3"]);
  });

  it("handles escaped quotes, a missing final semicolon and empty statements", () => {
    expect(splitStatements("SELECT 'it''s; fine';;  ;SELECT 2")).toEqual(["SELECT 'it''s; fine'", "SELECT 2"]);
    expect(splitStatements("  -- just a comment\n")).toEqual([]);
  });

  it("keeps a CREATE TRIGGER body, with its inner semicolons, as one statement", () => {
    const trigger = `CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; INSERT INTO log VALUES (1); END`;
    expect(splitStatements(`${trigger}; SELECT 1;`)).toEqual([trigger, "SELECT 1"]);
  });
});

describe("findDotCommand", () => {
  it("finds shell commands but not numbers", () => {
    expect(findDotCommand("SELECT 1;\n.tables\n")).toBe(".tables");
    expect(findDotCommand("  .shell id")).toBe(".shell");
    expect(findDotCommand("SELECT .5 + .25;")).toBeNull();
  });
});

describe("parseSqliteJson", () => {
  it("reads rows in order, with types and NULL", () => {
    expect(parseSqliteJson('[{"id":1,"name":"x\\"y","score":1.5},\n{"id":2,"name":null,"score":2.0}]')).toEqual({
      columns: ["id", "name", "score"],
      rows: [
        [1, 'x"y', 1.5],
        [2, null, 2],
      ],
    });
  });

  it("keeps duplicate column names, which JSON.parse would lose", () => {
    expect(parseSqliteJson('[{"id":1,"id":2}]')).toEqual({ columns: ["id", "id"], rows: [[1, 2]] });
  });

  it("returns null for no output and for nonsense", () => {
    expect(parseSqliteJson("")).toBeNull();
    expect(parseSqliteJson("oops")).toBeNull();
  });
});

describe("splitOutput", () => {
  it("separates what each marker follows", () => {
    const run = splitOutput('@@SB:setup@@\n[{"a":1}]\n@@SB:stmt:0@@\n@@SB:stmt:1@@\n');
    expect(run.reached).toEqual(["setup", "stmt:0", "stmt:1"]);
    expect(run.sections.get("stmt:0")).toBe('[{"a":1}]\n');
    // A statement with no rows prints nothing: an empty section, not a missing one.
    expect(run.sections.get("stmt:1")).toBe("");
  });
});

describe("buildSqlScript", () => {
  it("runs the setup, then each statement with its marker, then the test's query", () => {
    const script = buildSqlScript("CREATE TABLE a(x)", ["INSERT INTO a VALUES (1)", "SELECT * FROM a"], "SELECT count(*) FROM a;");
    expect(script.split("\n").filter(Boolean)).toEqual([
      "PRAGMA foreign_keys = ON;",
      "CREATE TABLE a(x);",
      ".print @@SB:setup@@",
      "INSERT INTO a VALUES (1);",
      ".print @@SB:stmt:0@@",
      "SELECT * FROM a;",
      ".print @@SB:stmt:1@@",
      "SELECT count(*) FROM a;",
      ".print @@SB:query@@",
    ]);
  });
});

describe("parseSqlTest", () => {
  it("reads a test, or says what is wrong with it", () => {
    expect(parseSqlTest('{"expect":[[1]],"ordered":true}')).toEqual({ expect: [[1]], query: null, ordered: true, columns: null });
    expect(parseSqlTest("nope")).toMatch(/valid JSON/);
    expect(parseSqlTest('{"expect":[1]}')).toMatch(/list of rows/);
    expect(parseSqlTest('{"expect":[],"query":3}')).toMatch(/query/);
  });
});

describe("compareResult", () => {
  const t = (over: object) => parseSqlTest(JSON.stringify({ expect: [], ...over })) as Exclude<ReturnType<typeof parseSqlTest>, string>;
  const set = (columns: string[], rows: unknown[][]) => ({ columns, rows });

  it("ignores row order unless asked, and compares numbers with a tolerance", () => {
    const result = set(["a", "b"], [[2, 0.1 + 0.2], [1, 1]]);
    expect(compareResult(result, t({ expect: [[1, 1], [2, 0.3]] }))).toBeNull();
    expect(compareResult(result, t({ expect: [[1, 1], [2, 0.3]], ordered: true }))).toMatch(/row 1: expected \(1, 1\), got \(2, 0.3/);
  });

  it("says how many rows were expected and what came back", () => {
    expect(compareResult(set(["a"], [[1], [2]]), t({ expect: [[1]] }))).toBe("expected 1 row, got 2: (1), (2)");
    expect(compareResult(null, t({ expect: [[1]] }))).toBe("expected 1 row, got 0");
    expect(compareResult(set(["a"], []), t({ expect: [] }))).toBeNull();
  });

  it("tells NULL from text and shows the differing row", () => {
    expect(compareResult(set(["a"], [[null]]), t({ expect: [["x"]] }))).toBe("row 1 (after sorting): expected ('x'), got (NULL)");
  });

  it("checks column names when asked, ignoring case", () => {
    expect(compareResult(set(["Name"], [["a"]]), t({ expect: [["a"]], columns: ["name"] }))).toBeNull();
    expect(compareResult(set(["n"], [["a"]]), t({ expect: [["a"]], columns: ["name"] }))).toMatch(/expected columns \(name\), got \(n\)/);
  });
});

describe("formatTable and errors", () => {
  it("aligns a result as text and trims long ones", () => {
    const text = formatTable({ columns: ["id", "name"], rows: [[1, "Ada"], [22, null]] });
    expect(text.split("\n")).toEqual(["id | name", "---+-----", "1  | Ada", "22 | NULL"]);
    expect(formatTable({ columns: ["n"], rows: Array.from({ length: 30 }, (_, i) => [i]) }, 2)).toContain("… 28 more rows");
    expect(formatTable(null)).toBe("");
  });

  it("drops the shell's location prefix from an error", () => {
    expect(cleanSqlError("Parse error near line 10 of run.sql: no such column: nope\n  SELECT nope\n")).toBe("no such column: nope");
    expect(cleanSqlError("Runtime error near line 3: UNIQUE constraint failed: a.id")).toBe("UNIQUE constraint failed: a.id");
    expect(cleanSqlError("")).toBe("The SQL couldn't run.");
  });
});
