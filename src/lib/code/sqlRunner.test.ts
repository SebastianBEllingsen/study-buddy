import { describe, expect, it } from "vitest";
import { runSqlTests, sqlToolchainAvailable } from "./sqlRunner";

// These really run SQL through the sandbox, so they need sqlite3 and
// bubblewrap — skipped on a machine without them.
const available = sqlToolchainAvailable();
const SETUP = `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total REAL NOT NULL);
INSERT INTO customers VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Linus');
INSERT INTO orders VALUES (1, 1, 10.5), (2, 1, 4.5), (3, 2, 7);`;
const test = (name: string, spec: object) => ({ name, code: JSON.stringify(spec) });
const TIMEOUT = 30_000;

describe.skipIf(!available)("runSqlTests", () => {
  it("compares the learner's last SELECT with the expected rows", async () => {
    const result = await runSqlTests(
      "SELECT c.name, SUM(o.total) AS total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.id;",
      [
        test("totals", { expect: [["Ada", 15], ["Grace", 7]], columns: ["name", "total"] }),
        test("wrong", { expect: [["Ada", 99]] }),
      ],
      SETUP
    );
    expect(result.error).toBeNull();
    expect(result.tests.map((t) => t.passed)).toEqual([true, false]);
    expect(result.tests[1].message).toMatch(/expected 1 row, got 2/);
    expect(result.stdout).toContain("Ada   | 15");
  }, TIMEOUT);

  it("stops a statement that tries to fill memory, and the learner can't lift the limit", async () => {
    const result = await runSqlTests(
      "PRAGMA hard_heap_limit = 0; PRAGMA hard_heap_limit = 99999999999; CREATE TABLE big (x); INSERT INTO big VALUES (zeroblob(300000000));",
      [test("never", { expect: [] })],
      SETUP
    );
    expect(result.error).toMatch(/memory/i);
    expect(result.tests[0].passed).toBe(false);
  }, TIMEOUT);

  it("treats an empty last result as zero rows rather than the one before it", async () => {
    const result = await runSqlTests("SELECT 1; SELECT name FROM customers WHERE id = 99;", [test("none", { expect: [] })], SETUP);
    expect(result.tests[0]).toEqual({ name: "none", passed: true, message: null });
  }, TIMEOUT);

  it("checks the state after data-changing SQL with the test's own query, on a fresh database each test", async () => {
    const result = await runSqlTests(
      "INSERT INTO customers VALUES (4, 'Ken'); CREATE INDEX idx_orders_customer ON orders(customer_id);",
      [
        test("row added", { query: "SELECT count(*) FROM customers", expect: [[4]] }),
        test("index exists", { query: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'orders' AND name NOT LIKE 'sqlite_%'", expect: [["idx_orders_customer"]] }),
        test("still four, not eight", { query: "SELECT count(*) FROM customers", expect: [[4]] }),
      ],
      SETUP
    );
    expect(result.tests.map((t) => t.message)).toEqual([null, null, null]);
  }, TIMEOUT);

  it("enforces constraints and reports the database's own error", async () => {
    const result = await runSqlTests("INSERT INTO orders VALUES (9, 77, 1);", [test("t", { expect: [] })], SETUP);
    expect(result.error).toMatch(/FOREIGN KEY constraint failed/);
    expect(result.tests[0].passed).toBe(false);
  }, TIMEOUT);

  it("reports a syntax error without the shell's file location", async () => {
    const result = await runSqlTests("SELEC * FROM customers;", [test("t", { expect: [] })], SETUP);
    expect(result.error).toMatch(/syntax error/);
    expect(result.error).not.toMatch(/near line/);
  }, TIMEOUT);

  it("blames the exercise, not the learner, when its setup is broken", async () => {
    const result = await runSqlTests("SELECT 1;", [test("t", { expect: [[1]] })], "CREATE TABLE oops (");
    expect(result.error).toMatch(/^The exercise's setup failed/);
  }, TIMEOUT);

  it("refuses the sqlite3 shell's own commands", async () => {
    const result = await runSqlTests(".shell id", [test("t", { expect: [] })], SETUP);
    expect(result.error).toMatch(/\.shell is a command of the sqlite3 shell/);
  }, TIMEOUT);

  it("marks a test that isn't valid JSON as failing, without hiding the others", async () => {
    const result = await runSqlTests("SELECT 1;", [{ name: "bad", code: "not json" }, test("good", { expect: [[1]] })], SETUP);
    expect(result.tests.map((t) => t.passed)).toEqual([false, true]);
  }, TIMEOUT);

  it("stops a query that never ends", async () => {
    const result = await runSqlTests(
      "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r;",
      [test("t", { expect: [[1]] })],
      SETUP
    );
    expect(result.error).toMatch(/Took too long/);
  }, 60_000);

  it("runs inside the sandbox: the shell can't read host files", async () => {
    const result = await runSqlTests("SELECT readfile('/etc/passwd') IS NULL AS blocked;", [test("t", { expect: [[1]] })], SETUP);
    expect(result.tests[0].passed).toBe(true);
  }, TIMEOUT);
});
