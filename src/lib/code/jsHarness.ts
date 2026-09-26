import type { RunResult } from "./types";

// Runs JavaScript code and its tests. Kept as plain JavaScript source text,
// not a compiled function, because it's sent into a Web Worker (see
// workerSource.ts) — a function's toString() would carry whatever helpers
// the bundler wrapped it in. Tests run this same text (runJavaScriptTests
// below), so what's tested is exactly what the worker runs.
//
// The learner's code runs once on its own (for its printed output and any
// load error), then again, fresh, in front of each test, so one test's side
// effects can't leak into the next.
export const JS_HARNESS_SOURCE = String.raw`
function runJavaScriptTests(code, tests) {
  var MAX_OUTPUT = 20000;
  var lines = [];
  function format(value) {
    if (typeof value === "string") return value;
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (value === undefined) return "undefined";
    try {
      var json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch (e) {
      return String(value);
    }
  }
  // In assertion messages strings are quoted, so "12" and 12 differ.
  function show(value) {
    return typeof value === "string" ? JSON.stringify(value) : format(value);
  }
  function makeConsole(sink) {
    function log() {
      if (sink) sink.push(Array.prototype.map.call(arguments, format).join(" "));
    }
    return { log: log, info: log, warn: log, error: log, debug: log };
  }
  function AssertionError(message) {
    this.message = message;
  }
  function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a);
    var kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) {
      return deepEqual(a[k], b[k]);
    });
  }
  function assert(condition, message) {
    if (!condition) throw new AssertionError(message || "An assertion failed");
  }
  assert.equal = function (actual, expected, message) {
    if (!deepEqual(actual, expected)) {
      throw new AssertionError((message ? message + ": " : "") + "expected " + show(expected) + ", got " + show(actual));
    }
  };
  function describe(err) {
    if (err instanceof AssertionError) return err.message;
    if (err instanceof Error) return err.name + ": " + err.message;
    return "Thrown: " + show(err);
  }
  var error = null;
  try {
    new Function("console", "assert", code)(makeConsole(lines), assert);
  } catch (err) {
    error = describe(err);
  }
  var results = tests.map(function (test) {
    if (error !== null) return { name: test.name, passed: false, message: "Your code didn't run: " + error };
    try {
      new Function("console", "assert", code + "\n;\n" + test.code)(makeConsole(null), assert);
      return { name: test.name, passed: true, message: null };
    } catch (err) {
      return { name: test.name, passed: false, message: describe(err) };
    }
  });
  return { stdout: lines.join("\n").slice(0, MAX_OUTPUT), error: error, tests: results };
}
`;

// The harness as a callable function, from the same source text.
export const runJavaScriptTests = new Function(`${JS_HARNESS_SOURCE}\nreturn runJavaScriptTests;`)() as (
  code: string,
  tests: { name: string; code: string }[]
) => RunResult;
