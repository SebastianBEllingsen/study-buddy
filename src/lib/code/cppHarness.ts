import type { ProcessResult, TestOutcome } from "./types";

// The C++ side of code exercises (see cppRunner.ts for how it's compiled
// and run). Pure: builds the one program a run compiles — the learner's
// code, then the tests — and reads the compiler's and the program's
// output back into test results.
//
// One program per run, one process per test: the learner's code is
// compiled once, then each test runs in its own process, so a crash,
// endless loop or sanitizer error in one test fails only that test.

export const CPP_USER_FILE = "your_code.cpp";
export const NO_MAIN_EXIT = 111;
const FAILURE_EXIT = 3;
const EXCEPTION_EXIT = 4;
export const SANITIZER_EXIT = 77;

export function cppTestFile(index: number): string {
  return `test_${index}.cpp`;
}

// Everything the harness needs before the learner's code, kept minimal so
// a missing #include in their code is a real compile error rather than
// something this prelude quietly covered for them.
const PRELUDE = String.raw`#include <cstdlib>
#include <exception>
#include <functional>
#include <iostream>
#include <iterator>
#include <sstream>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>

namespace sb {
struct Failure {
  std::string message;
};

template <class T>
concept Streamable = requires(std::ostream& o, const T& v) { o << v; };
template <class T>
concept Sequence = requires(const T& v) {
  std::begin(v);
  std::end(v);
} && !std::is_convertible_v<const T&, std::string_view>;

template <class T> std::string show(const T& v);
template <class A, class B> std::string show(const std::pair<A, B>& p);

template <class T> std::string show(const T& v) {
  std::ostringstream o;
  if constexpr (std::is_convertible_v<const T&, std::string_view>) {
    o << '"' << std::string_view(v) << '"';
  } else if constexpr (std::is_same_v<T, bool>) {
    o << (v ? "true" : "false");
  } else if constexpr (std::is_same_v<T, char>) {
    o << '\'' << v << '\'';
  } else if constexpr (Sequence<T>) {
    o << "[";
    bool first = true;
    for (const auto& x : v) {
      if (!first) o << ", ";
      first = false;
      o << show(x);
    }
    o << "]";
  } else if constexpr (Streamable<T>) {
    o << v;
  } else {
    o << "<value>";
  }
  return o.str();
}
template <class A, class B> std::string show(const std::pair<A, B>& p) {
  return "(" + show(p.first) + ", " + show(p.second) + ")";
}

[[noreturn]] inline void fail(const std::string& message) { throw Failure{message}; }

inline void check(bool ok, const char* expr, const std::string& message, int line) {
  if (ok) return;
  fail((message.empty() ? std::string("CHECK failed: ") + expr : message + " (" + expr + ")") + " [line " +
       std::to_string(line) + " of the test]");
}

template <class A, class B> void check_eq(const A& actual, const B& expected, int line) {
  if (actual == expected) return;
  fail("expected " + show(expected) + ", got " + show(actual) + " [line " + std::to_string(line) + " of the test]");
}

inline void check_near(double actual, double expected, double tolerance, int line) {
  if (actual - expected <= tolerance && expected - actual <= tolerance) return;
  fail("expected " + show(expected) + " (within " + show(tolerance) + "), got " + show(actual) + " [line " +
       std::to_string(line) + " of the test]");
}

// Runs fn with std::cin reading from input and std::cout captured, and
// returns what it printed. For testing programs that read and print.
inline std::string capture(const std::function<void()>& fn, const std::string& input = "") {
  std::istringstream in(input);
  std::ostringstream out;
  auto* old_in = std::cin.rdbuf(in.rdbuf());
  auto* old_out = std::cout.rdbuf(out.rdbuf());
  try {
    fn();
  } catch (...) {
    std::cin.rdbuf(old_in);
    std::cout.rdbuf(old_out);
    throw;
  }
  std::cin.rdbuf(old_in);
  std::cout.rdbuf(old_out);
  return out.str();
}
}  // namespace sb

// A second name for the learner's main() — the real, unrenamed one — so
// tests can run their program with run_main(input).
extern "C" int sb_call_main(int, char**) __asm__("main");
`;

const AFTER_USER_CODE = String.raw`#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <deque>
#include <limits>
#include <map>
#include <memory>
#include <numeric>
#include <optional>
#include <queue>
#include <set>
#include <stack>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>

#define CHECK(cond, ...) ::sb::check(static_cast<bool>(cond), #cond, std::string(__VA_ARGS__), __LINE__)
#define CHECK_EQ(actual, expected) ::sb::check_eq((actual), (expected), __LINE__)
#define CHECK_NEAR(actual, expected, tolerance) ::sb::check_near((actual), (expected), (tolerance), __LINE__)
#define CHECK_THROWS(expr)                                                  \
  do {                                                                      \
    bool sb_threw = false;                                                  \
    try {                                                                   \
      (void)(expr);                                                         \
    } catch (...) {                                                         \
      sb_threw = true;                                                      \
    }                                                                       \
    ::sb::check(sb_threw, "expected an exception from " #expr, "", __LINE__); \
  } while (0)

namespace sb {
// Runs the learner's main() with the given input and returns what it printed.
inline std::string run_main(const std::string& input = "") {
  return capture(
      [] {
        char name[] = "program";
        char* argv[] = {name, nullptr};
        sb_call_main(1, argv);
      },
      input);
}
}  // namespace sb
using sb::run_main;
`;

// A program with no main() of its own (a function-only exercise) still
// needs one to link: this is the weak fallback, a second file, so a main()
// in the learner's code wins. Exits with NO_MAIN_EXIT so the runner can tell.
export const CPP_FALLBACK_MAIN_FILE = "fallback_main.cpp";
export const CPP_FALLBACK_MAIN = `__attribute__((weak)) int main() { return ${NO_MAIN_EXIT}; }\n`;

// The learner's main() stays the real main (renaming it would lose C++'s
// implicit "return 0"). A test run — "./prog test N" — is dispatched from a
// constructor that runs after the learner's globals are built and before
// main(), runs one test, and exits; any other run just runs the program.
//
// A multi-file project is the same, except that the learner's code isn't
// pasted in: the program includes the project's headers (so the tests see
// its declarations) and the project's other sources are compiled and linked
// beside it (see cppRunner.ts).
export function buildCppProgram(source: string | { headers: string[] }, tests: { index: number; code: string }[]): string {
  const userCode =
    typeof source === "string"
      ? `#line 1 "${CPP_USER_FILE}"\n${source}\n`
      : `${source.headers.map((h) => `#include "${h}"`).join("\n")}\n`;
  const bodies = tests
    .map(
      (t) =>
        `#line 1 "${cppTestFile(t.index)}"\nstatic void sb_test_${t.index}() { using namespace std; using namespace sb; ${t.code}\n}\n`
    )
    .join("");
  const table = tests.map((t) => `    case ${t.index}: sb_test_${t.index}(); break;`).join("\n");
  return `${PRELUDE}${userCode}#line 1 "harness.cpp"\n${AFTER_USER_CODE}${bodies}#line 1 "harness.cpp"
__attribute__((constructor)) static void sb_dispatch(int argc, char** argv) {
  if (argc < 3 || std::string(argv[1]) != "test") return;
  int status = 0;
  try {
    switch (std::atoi(argv[2])) {
${table}
    default: status = 2;
    }
  } catch (const sb::Failure& f) {
    std::cerr << "SB_FAILURE: " << f.message << "\\n";
    status = ${FAILURE_EXIT};
  } catch (const std::exception& e) {
    std::cerr << "SB_EXCEPTION: " << e.what() << "\\n";
    status = ${EXCEPTION_EXIT};
  } catch (...) {
    std::cerr << "SB_EXCEPTION: something that isn't a std::exception was thrown\\n";
    status = ${EXCEPTION_EXIT};
  }
  std::exit(status);
}
`;
}

export interface Diagnostic {
  file: string;
  line: number;
  severity: "error" | "warning" | "note";
  // The whole block as the compiler printed it (message, source line, caret).
  text: string;
}

// Splits compiler output into diagnostics. A diagnostic starts at a
// "file:line:col: severity:" line and runs until the next one; the
// "In function ..." lines before it and the source/caret lines after it
// belong to it.
export function parseDiagnostics(stderr: string): Diagnostic[] {
  const head = /^([^\s:][^:]*):(\d+):(?:\d+:)?\s*(fatal error|error|warning|note):/;
  const out: Diagnostic[] = [];
  let current: Diagnostic | null = null;
  for (const line of stderr.replace(/\r\n/g, "\n").split("\n")) {
    const m = head.exec(line);
    if (!m && (/^\S+: In /.test(line) || /^In file included from|^\s+from /.test(line))) {
      // "In function ..." / "included from ..." context for what follows.
      current = null;
    } else if (m) {
      const severity = m[3] === "fatal error" ? "error" : (m[3] as Diagnostic["severity"]);
      current = { file: m[1], line: Number(m[2]), severity, text: line };
      out.push(current);
    } else if (current && line.trim() !== "") {
      current.text += `\n${line}`;
    } else if (!line.trim()) {
      current = null;
    }
  }
  return out;
}

const MAX_DIAGNOSTIC_CHARS = 2500;

export function formatDiagnostics(list: Diagnostic[]): string {
  return list
    .map((d) => d.text)
    .join("\n\n")
    .slice(0, MAX_DIAGNOSTIC_CHARS);
}

const SIGNAL_NAMES: Record<string, string> = {
  SIGSEGV: "a segmentation fault (invalid memory access)",
  SIGABRT: "an abort (an assertion failed or the program called abort)",
  SIGFPE: "an arithmetic error (such as dividing by zero)",
  SIGILL: "an illegal instruction",
  SIGBUS: "a bus error (invalid memory access)",
  SIGKILL: "being killed (out of memory or time?)",
  SIGXCPU: "using too much CPU time",
};

// The few lines of a sanitizer report worth showing: what went wrong and
// the frames inside the learner's own code.
export function summarizeSanitizer(stderr: string): string {
  const lines = stderr.split("\n");
  const what = lines.filter((l) => /ERROR: (Address|Leak)Sanitizer|runtime error:|SUMMARY:/.test(l)).slice(0, 3);
  const frames = lines.filter((l) => /^\s*#\d+ /.test(l) && l.includes(CPP_USER_FILE)).slice(0, 4);
  const text = [...what, ...frames].map((l) => l.replace(/^==\d+==/, "").replace(/\s+/g, " ").trim()).join("\n");
  return text || stderr.trim().slice(0, 600);
}

// One test process's outcome → the test's result.
export function classifyTestRun(run: ProcessResult): { passed: boolean; message: string | null } {
  if (run.timedOut) return { passed: false, message: "Took too long — is there an endless loop?" };
  if (run.exitCode === 0 && run.signal === null) return { passed: true, message: null };
  if (run.signal) {
    const reason = SIGNAL_NAMES[run.signal] ?? `signal ${run.signal}`;
    return { passed: false, message: `The program stopped with ${reason}.` };
  }
  const failure = /SB_FAILURE: ([^\n]*)/.exec(run.stderr);
  if (run.exitCode === FAILURE_EXIT && failure) return { passed: false, message: failure[1].slice(0, 1000) };
  const exception = /SB_EXCEPTION: ([^\n]*)/.exec(run.stderr);
  if (run.exitCode === EXCEPTION_EXIT && exception) {
    return { passed: false, message: `An exception escaped: ${exception[1]}`.slice(0, 1000) };
  }
  if (/Sanitizer|runtime error:/.test(run.stderr)) return { passed: false, message: summarizeSanitizer(run.stderr).slice(0, 1000) };
  return { passed: false, message: `The program exited with code ${run.exitCode}.` };
}

export function outcomeFor(name: string, run: ProcessResult): TestOutcome {
  return { name, ...classifyTestRun(run) };
}
