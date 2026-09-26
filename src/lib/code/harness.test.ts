import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { runJavaScriptTests } from "./jsHarness";
import { PYTHON_HARNESS } from "./pythonHarness";
import { workerSource } from "./workerSource";
import { brokenTestNames, withoutBroken } from "./runner";

describe("runJavaScriptTests", () => {
  const add = "function add(a, b) { return a + b; }\nconsole.log('loaded', { ok: true });";

  it("reports passing and failing tests, with the printed output", () => {
    const result = runJavaScriptTests(add, [
      { name: "adds", code: "assert.equal(add(2, 3), 5)" },
      { name: "wrong on purpose", code: "assert.equal(add([1], 2), [3], 'arrays')" },
      { name: "plain assert", code: "assert(add(1, 1) === 3, 'one plus one is three?')" },
    ]);
    expect(result.error).toBeNull();
    expect(result.stdout).toBe('loaded {"ok":true}');
    expect(result.tests).toEqual([
      { name: "adds", passed: true, message: null },
      { name: "wrong on purpose", passed: false, message: 'arrays: expected [3], got "12"' },
      { name: "plain assert", passed: false, message: "one plus one is three?" },
    ]);
  });

  it("compares deeply", () => {
    const result = runJavaScriptTests("const f = () => ({ a: [1, { b: 2 }] });", [
      { name: "deep", code: "assert.equal(f(), { a: [1, { b: 2 }] })" },
    ]);
    expect(result.tests[0].passed).toBe(true);
  });

  it("fails every test when the code itself doesn't run", () => {
    const result = runJavaScriptTests("function broken( {", [{ name: "t", code: "assert(true)" }]);
    expect(result.error).toMatch(/^SyntaxError/);
    expect(result.tests[0]).toMatchObject({ passed: false });
    expect(result.tests[0].message).toMatch(/^Your code didn't run/);
  });

  it("runs each test against a fresh copy of the code", () => {
    const result = runJavaScriptTests("let count = 0; function bump() { return ++count; }", [
      { name: "first", code: "assert.equal(bump(), 1)" },
      { name: "second", code: "assert.equal(bump(), 1)" },
    ]);
    expect(result.tests.every((t) => t.passed)).toBe(true);
  });

  it("reports a runtime error inside a test", () => {
    const result = runJavaScriptTests("function f() { return null; }", [{ name: "t", code: "f().x" }]);
    expect(result.tests[0].message).toMatch(/^TypeError/);
  });
});

describe("workerSource", () => {
  it("cuts the worker off from the network before running code", () => {
    const source = workerSource();
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts"]) expect(source).toContain(`"${name}"`);
    expect(source.indexOf("lockDown();\n      self.postMessage({ id, result: runJavaScriptTests")).toBeGreaterThan(0);
    expect(() => new Function(source)).not.toThrow();
    // Nothing the bundler adds may leak in: the worker has no module helpers.
    expect(source).not.toMatch(/__name\(|__vite|_interop/);
  });
});

describe("broken tests", () => {
  it("are the ones the reference solution fails", () => {
    const run = {
      stdout: "",
      error: null,
      tests: [
        { name: "a", passed: true, message: null },
        { name: "b", passed: false, message: "x" },
      ],
    };
    const broken = brokenTestNames(run);
    expect([...broken]).toEqual(["b"]);
    expect(withoutBroken(run.tests, broken).map((t) => t.name)).toEqual(["a"]);
    expect(brokenTestNames({ ...run, error: "SyntaxError" }).size).toBe(0);
  });
});

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// The same harness Pyodide runs, checked under a local CPython when one is
// installed (Pyodide itself can't run under the test runner).
describe.skipIf(!hasPython())("Python harness", () => {
  function run(code: string, tests: { name: string; code: string }[]) {
    const program = `__user_code = ${JSON.stringify(code)}\n__tests_json = ${JSON.stringify(JSON.stringify(tests))}\n${PYTHON_HARNESS.replace(
      /\njson\.dumps\((.*)\)\n$/,
      "\nprint(json.dumps($1))\n"
    )}`;
    return JSON.parse(execFileSync("python3", ["-c", program], { encoding: "utf8" }));
  }

  it("reports passing and failing tests, with the printed output", () => {
    const result = run("def add(a, b):\n    return a + b\nprint('loaded')", [
      { name: "adds", code: "assert add(2, 3) == 5, 'add(2, 3) should be 5'" },
      { name: "fails", code: "assert add(2, 2) == 5, 'add(2, 2) should be 5'" },
      { name: "no message", code: "assert False" },
    ]);
    expect(result.stdout).toBe("loaded\n");
    expect(result.error).toBeNull();
    expect(result.tests).toEqual([
      { name: "adds", passed: true, message: null },
      { name: "fails", passed: false, message: "add(2, 2) should be 5" },
      { name: "no message", passed: false, message: "An assertion failed" },
    ]);
  });

  it("points at the line of a syntax or runtime error", () => {
    expect(run("def f(:\n    pass", [{ name: "t", code: "pass" }]).error).toMatch(/^SyntaxError: .*\(line 1 of your code\)$/);
    const result = run("def f(xs):\n    return xs[10]", [{ name: "t", code: "f([])" }]);
    expect(result.tests[0].message).toBe("IndexError: list index out of range (line 2 of your code)");
  });

  it("explains that input() isn't available", () => {
    const result = run("def ask():\n    return input()", [{ name: "t", code: "ask()" }]);
    expect(result.tests[0].message).toMatch(/^RuntimeError: input\(\) isn't available here.*\(line 2 of your code\)$/);
  });

  it("keeps tests from affecting each other", () => {
    const result = run("items = []\ndef push(x):\n    items.append(x)\n    return len(items)", [
      { name: "a", code: "assert push(1) == 1" },
      { name: "b", code: "items2 = 1\nassert 'items2' in dir()" },
      { name: "c", code: "assert 'items2' not in dir()" },
    ]);
    expect(result.tests.map((t: { passed: boolean }) => t.passed)).toEqual([true, true, true]);
  });
});

describe("sandbox document", () => {
  it("blocks the network except the Pyodide CDN, and embeds the worker safely", async () => {
    const { sandboxDocument, SANDBOX_CSP } = await import("./runner");
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toMatch(/connect-src https:\/\/cdn\.jsdelivr\.net\/pyodide\/[^;]+$/);
    const doc = sandboxDocument();
    expect(doc).toContain(`content="${SANDBOX_CSP}"`);
    // Only the frame's own closing tag: the embedded source can't end it early.
    expect(doc.match(/<\/script/g)).toHaveLength(1);
  });
});
