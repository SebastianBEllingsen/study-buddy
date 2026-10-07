import { describe, expect, it } from "vitest";
import { buildCppProgram, classifyTestRun, parseDiagnostics, summarizeSanitizer } from "./cppHarness";
import type { ProcessResult } from "./types";
import { isLocalRequest, parseRunRequest } from "./runRequest";

const run = (over: Partial<ProcessResult>): ProcessResult => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: "",
  stderr: "",
  ...over,
});

describe("buildCppProgram", () => {
  it("puts the learner's code first, with its own line numbers, then each test as a function", () => {
    const src = buildCppProgram("int add(int a, int b) { return a + b; }", [
      { index: 0, code: "CHECK_EQ(add(1, 2), 3);" },
      { index: 3, code: "CHECK(add(0, 0) == 0);" },
    ]);
    expect(src.indexOf('#line 1 "your_code.cpp"')).toBeLessThan(src.indexOf("int add"));
    expect(src.indexOf("int add")).toBeLessThan(src.indexOf("sb_test_0"));
    expect(src).toContain('#line 1 "test_3.cpp"');
    expect(src).toContain("case 3: sb_test_3(); break;");
    // The learner's main() is never renamed (that would lose its implicit "return 0").
    expect(src).not.toMatch(/#define main/);
    expect(src.indexOf("sb_dispatch")).toBeGreaterThan(src.indexOf("int add"));
  });

  it("doesn't include <vector> before the learner's code, so a missing include stays an error", () => {
    const src = buildCppProgram("", [{ index: 0, code: "" }]);
    const before = src.slice(0, src.indexOf('#line 1 "your_code.cpp"'));
    expect(before).not.toMatch(/#include <vector>|#include <algorithm>|bits\/stdc/);
  });
});

describe("parseDiagnostics", () => {
  const stderr = `your_code.cpp: In function 'int f()':
your_code.cpp:3:5: error: 'x' was not declared in this scope
    3 |     x = 1;
      |     ^
your_code.cpp:7:9: warning: unused variable 'y' [-Wunused-variable]
    7 |     int y = 2;
      |         ^
test_0.cpp:1:50: error: no matching function for call to 'g(int)'
harness.cpp: In function 'int sb::f()':
`;
  it("splits into blocks by file, line and severity, keeping the source lines", () => {
    const list = parseDiagnostics(stderr);
    expect(list.map((d) => [d.file, d.line, d.severity])).toEqual([
      ["your_code.cpp", 3, "error"],
      ["your_code.cpp", 7, "warning"],
      ["test_0.cpp", 1, "error"],
    ]);
    expect(list[0].text).toContain("x = 1;");
    expect(list[0].text).not.toContain("unused variable");
    // "In function" context lines don't leak into the previous block.
    expect(list[2].text).not.toContain("In function");
  });
});

describe("classifyTestRun", () => {
  it("passes on a clean exit", () => expect(classifyTestRun(run({}))).toEqual({ passed: true, message: null }));

  it("reports a failed check with its message", () => {
    const r = classifyTestRun(run({ exitCode: 3, stderr: "SB_FAILURE: expected 3, got 4 [line 1 of the test]\n" }));
    expect(r).toEqual({ passed: false, message: "expected 3, got 4 [line 1 of the test]" });
  });

  it("explains crashes, timeouts and escaped exceptions", () => {
    expect(classifyTestRun(run({ exitCode: null, signal: "SIGSEGV" })).message).toMatch(/segmentation fault/);
    expect(classifyTestRun(run({ exitCode: null, timedOut: true })).message).toMatch(/endless loop/);
    expect(classifyTestRun(run({ exitCode: 4, stderr: "SB_EXCEPTION: vector::at\n" })).message).toMatch(/vector::at/);
  });

  it("summarises a sanitizer report down to what went wrong and the learner's frames", () => {
    const stderr = [
      "==5==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x1",
      "WRITE of size 4 at 0x1 thread T0",
      "    #0 0x1 in f(int) your_code.cpp:5:3",
      "    #1 0x2 in main /usr/lib/libc.so.6",
      "SUMMARY: AddressSanitizer: heap-buffer-overflow your_code.cpp:5:3 in f(int)",
    ].join("\n");
    const summary = summarizeSanitizer(stderr);
    expect(summary).toContain("heap-buffer-overflow");
    expect(summary).toContain("your_code.cpp:5:3");
    expect(summary).not.toContain("libc");
    expect(classifyTestRun(run({ exitCode: 77, stderr })).message).toContain("heap-buffer-overflow");
  });
});

describe("run request checks", () => {
  const ok = { language: "cpp", code: "int x;", tests: [{ name: "t", code: "CHECK(true);" }] };
  it("accepts a well-formed request and rejects others", () => {
    expect(parseRunRequest(ok)).toEqual({ language: "cpp", setup: "", code: "int x;", files: null, tests: [{ name: "t", code: "CHECK(true);" }] });
    expect(parseRunRequest({ ...ok, language: "sql", setup: "CREATE TABLE a(x);" })?.setup).toBe("CREATE TABLE a(x);");
    expect(parseRunRequest({ ...ok, language: "csharp" })?.language).toBe("csharp");
    expect(parseRunRequest({ ...ok, language: "python" })).toBeNull();
    // A project: files instead of code, with safe names, within limits.
    const files = [{ name: "a.hpp", content: "#pragma once" }, { name: "a.cpp", content: "" }];
    expect(parseRunRequest({ language: "cpp", files, tests: ok.tests })).toMatchObject({ code: "", files });
    for (const bad of [
      [{ name: "../evil.cpp", content: "" }],
      [{ name: "sub/a.cpp", content: "" }],
      [{ name: "a.txt", content: "" }],
      [{ name: "prog.cpp", content: "" }],
      [{ name: "a.cpp", content: "" }, { name: "A.cpp", content: "" }],
      [],
    ]) {
      expect(parseRunRequest({ language: "cpp", files: bad, tests: ok.tests })).toBeNull();
    }
    expect(parseRunRequest({ language: "sql", files, tests: ok.tests })).toBeNull();
    expect(parseRunRequest({ language: "csharp", files: [{ name: "a.cpp", content: "" }], tests: ok.tests })).toBeNull();
    expect(parseRunRequest({ ...ok, code: 1 })).toBeNull();
    expect(parseRunRequest({ ...ok, tests: [{ name: "t" }] })).toBeNull();
    expect(parseRunRequest({ ...ok, tests: Array(21).fill(ok.tests[0]) })).toBeNull();
  });

  const headers = (h: Record<string, string>) => new Headers({ "content-type": "application/json", ...h });
  it("only answers same-origin JSON requests to a localhost host", () => {
    expect(isLocalRequest(headers({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(isLocalRequest(headers({ host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(true);
    expect(isLocalRequest(headers({ host: "127.0.0.1:3000", origin: "https://evil.example" }))).toBe(false);
    expect(isLocalRequest(headers({ host: "evil.example" }))).toBe(false); // DNS rebinding
    expect(isLocalRequest(new Headers({ host: "127.0.0.1:3000", "content-type": "text/plain" }))).toBe(false);
  });
});
