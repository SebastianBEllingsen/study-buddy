import { describe, expect, it } from "vitest";
import { cppToolchainAvailable, runCppTests } from "./cppRunner";

// These really compile and run C++ through the sandbox, so they need g++,
// bubblewrap and prlimit — skipped on a machine without them.
const available = cppToolchainAvailable();
const t = (name: string, code: string) => ({ name, code });
const TIMEOUT = 60_000;

describe.skipIf(!available)("runCppTests", () => {
  it("passes and fails individual tests with readable messages", async () => {
    const result = await runCppTests("int add(int a, int b) { return a + b; }", [
      t("adds", "CHECK_EQ(add(2, 3), 5);"),
      t("wrong expectation", "CHECK_EQ(add(2, 3), 6);"),
      t("vectors print nicely", "std::vector<int> v{1, 2}; CHECK_EQ(v, (std::vector<int>{1, 3}));"),
    ]);
    expect(result.error).toBeNull();
    expect(result.tests.map((x) => x.passed)).toEqual([true, false, false]);
    expect(result.tests[1].message).toContain("expected 6, got 5");
    expect(result.tests[2].message).toContain("expected [1, 3], got [1, 2]");
  }, TIMEOUT);

  it("reports a compile error in the learner's code, with their own line number", async () => {
    const result = await runCppTests("int f() {\n  return x;\n}", [t("a", "CHECK_EQ(f(), 1);")]);
    expect(result.error).toMatch(/your_code\.cpp:2:\d+: error: 'x' was not declared/);
    expect(result.tests[0].passed).toBe(false);
  }, TIMEOUT);

  it("keeps a test that can't be built from failing the others", async () => {
    const result = await runCppTests("int one() { return 1; }", [
      t("good", "CHECK_EQ(one(), 1);"),
      t("calls something undefined", "CHECK_EQ(nothing_here(), 1);"),
    ]);
    expect(result.error).toBeNull();
    expect(result.tests[0].passed).toBe(true);
    expect(result.tests[1].passed).toBe(false);
    expect(result.tests[1].message).toMatch(/couldn't be built/);
  }, TIMEOUT);

  it("catches memory bugs with the sanitizers, per test", async () => {
    const code = `#include <vector>
int at(const std::vector<int>& v, int i) { return v[i]; }
void leak() { new int[4]; }`;
    const result = await runCppTests(code, [
      t("in range", "CHECK_EQ(at({1, 2, 3}, 1), 2);"),
      t("out of range", "at({1, 2, 3}, 9);"),
      t("leak", "leak();"),
    ]);
    expect(result.tests[0].passed).toBe(true);
    expect(result.tests[1].passed).toBe(false);
    expect(result.tests[2].passed).toBe(false);
    expect(result.tests[2].message).toMatch(/Leak/i);
  }, TIMEOUT);

  it("stops an endless loop without hanging the other tests", async () => {
    const result = await runCppTests("void spin() { for (;;) {} }\nint ok() { return 1; }", [
      t("spins", "spin();"),
      t("fine", "CHECK_EQ(ok(), 1);"),
    ]);
    expect(result.tests[0].message).toMatch(/endless loop/);
    expect(result.tests[1].passed).toBe(true);
  }, TIMEOUT);

  it("runs a program that reads input and prints, and captures its own main", async () => {
    const code = `#include <iostream>
int main() { int n; std::cin >> n; std::cout << n * 2 << "\\n"; }`;
    const result = await runCppTests(code, [t("doubles", 'CHECK_EQ(run_main("21\\n"), "42\\n");')]);
    expect(result.tests[0].passed).toBe(true);
    expect(result.error).toBeNull();
  }, TIMEOUT);

  it("is sandboxed: no host files outside the toolchain, and no network", async () => {
    const code = `#include <fstream>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
bool exists(const char* path) { return std::ifstream(path).good(); }
bool can_connect() {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return false;
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(80);
  inet_pton(AF_INET, "1.1.1.1", &addr.sin_addr);
  bool ok = connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) == 0;
  close(fd);
  return ok;
}`;
    const result = await runCppTests(code, [
      // /etc/passwd exists on every Linux host and is not mounted in the sandbox.
      t("host /etc/passwd is invisible", 'CHECK(!exists("/etc/passwd"));'),
      t("host home is invisible", 'CHECK(!exists("/home"));'),
      t("no network", "CHECK(!can_connect());"),
    ]);
    expect(result.error).toBeNull();
    expect(result.tests.map((x) => x.message)).toEqual([null, null, null]);
  }, TIMEOUT);

  it("warns about problems in the learner's code that still compile", async () => {
    const result = await runCppTests("int f() { int unused = 1; return 2; }", [t("f", "CHECK_EQ(f(), 2);")]);
    expect(result.tests[0].passed).toBe(true);
    expect(result.diagnostics).toMatch(/unused variable/);
  }, TIMEOUT);

  describe("multi-file projects", () => {
    const files = [
      { name: "stack.hpp", content: "#pragma once\n#include <vector>\nclass Stack {\n public:\n  void push(int v);\n  int pop();\n  bool empty() const;\n private:\n  std::vector<int> items_;\n};\n" },
      {
        name: "stack.cpp",
        content: '#include "stack.hpp"\n#include <stdexcept>\nvoid Stack::push(int v) { items_.push_back(v); }\nint Stack::pop() {\n  if (items_.empty()) throw std::out_of_range("empty");\n  int v = items_.back();\n  items_.pop_back();\n  return v;\n}\nbool Stack::empty() const { return items_.empty(); }\n',
      },
      { name: "main.cpp", content: '#include <iostream>\n#include "stack.hpp"\nint main() { Stack s; s.push(4); std::cout << s.pop() << "\\n"; }\n' },
    ];

    it("compiles the headers and sources together and runs the tests against them", async () => {
      const result = await runCppTests(files, [
        t("push then pop", "Stack s; s.push(1); s.push(2); CHECK_EQ(s.pop(), 2); CHECK_EQ(s.pop(), 1); CHECK(s.empty());"),
        t("pop of an empty stack throws", "Stack s; CHECK_THROWS(s.pop());"),
        t("runs the program's own main", 'CHECK_EQ(run_main(), "4\\n");'),
      ]);
      expect(result.error).toBeNull();
      expect(result.tests.map((x) => x.message)).toEqual([null, null, null]);
      expect(result.stdout).toBe("4\n");
    }, TIMEOUT);

    it("reports an error in one of the learner's files under that file's name", async () => {
      const broken = files.map((f) => (f.name === "stack.cpp" ? { ...f, content: f.content.replace("items_.push_back(v)", "items_.push_bak(v)") } : f));
      const result = await runCppTests(broken, [t("a", "Stack s; s.push(1);")]);
      expect(result.error).toMatch(/stack\.cpp:\d+:\d+: error: .*push_bak/);
      expect(result.tests[0].passed).toBe(false);
    }, TIMEOUT);

    it("explains a function that is declared but never defined", async () => {
      const missing = files.map((f) => (f.name === "stack.cpp" ? { ...f, content: '#include "stack.hpp"\n' } : f));
      const result = await runCppTests(missing, [t("push", "Stack s; s.push(1);")]);
      expect(result.error).toMatch(/didn't link: .*Stack::push\(int\).* declared but never defined/);
      expect(result.tests[0].passed).toBe(false);
    }, TIMEOUT);
  });
});
