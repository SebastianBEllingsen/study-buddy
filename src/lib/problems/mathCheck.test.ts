import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { buildCompareProgram, parseCompareOutput } from "./mathCheck";

describe("parseCompareOutput", () => {
  it("reads the match, and which side was unreadable", () => {
    expect(parseCompareOutput('{"match": "equal"}\n')).toEqual({ match: "equal" });
    expect(parseCompareOutput('noise\n{"match": "unreadable", "side": "model"}')).toEqual({ match: "unreadable", side: "model" });
  });

  it("treats anything else as unreadable", () => {
    for (const out of ["", "not json", '{"match": "yes"}', "{}", "null"]) {
      expect(parseCompareOutput(out).match).toBe("unreadable");
    }
  });
});

describe("buildCompareProgram", () => {
  it("passes the two texts as data, however odd they are", () => {
    const nasty = 'x"""\'\'\'\n\\n${1}`; import os';
    const program = buildCompareProgram(nasty, "y");
    // The texts appear only inside one JSON string literal, never as code.
    expect(program.startsWith("import json\n__args = json.loads(\"")).toBe(true);
    expect(program.split("import os").length - 1).toBe(1);
  });
});

function hasSympy(): boolean {
  try {
    execFileSync("python3", ["-c", "import sympy"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// The real comparison, under a local CPython with SymPy when there is one
// (the app runs the same program in Pyodide).
// Each comparison starts a Python process, so a test with several takes a few
// seconds — well past the default limit when the whole suite runs at once.
describe.skipIf(!hasSympy())("the comparison, with SymPy", { timeout: 60_000 }, () => {
  function compare(user: string, model: string) {
    return parseCompareOutput(execFileSync("python3", ["-c", buildCompareProgram(user, model)], { encoding: "utf8" }));
  }
  const match = (user: string, model: string) => compare(user, model).match;

  it("sees the same quantity in a different form", () => {
    expect(match("2*x + 2", "2*(x+1)")).toBe("equal");
    expect(match("x^2 - 1", "(x-1)(x+1)")).toBe("equal");
    expect(match("sqrt(2)/2", "1/sqrt(2)")).toBe("equal");
    expect(match("sin(x)^2 + cos(x)^2", "1")).toBe("equal");
    expect(match("3/4", "0.75")).toBe("equal");
    expect(match("2x+1", "1 + 2*x")).toBe("equal");
    expect(match("exp(-t)*sin(t)", "sin(t)/exp(t)")).toBe("equal");
    expect(match("e^x", "exp(x)")).toBe("equal");
  });

  it("tells different answers apart, including the classic slips", () => {
    expect(match("2*x + 1", "2*x - 1")).toBe("different");
    expect(match("(x+1)^2", "x^2 + 1")).toBe("different");
    expect(match("1/2", "1/3")).toBe("different");
    expect(match("x", "y")).toBe("different");
    expect(match("pi", "3.15")).toBe("different");
    expect(match("3", "x")).toBe("different");
  });

  it("reads simple LaTeX and an 'x =' prefix", () => {
    expect(match("\\frac{3}{4}", "3/4")).toBe("equal");
    expect(match("$\\frac{\\sqrt{3}}{2}$", "sqrt(3)/2")).toBe("equal");
    expect(match("x^{2} + \\pi", "x**2 + pi")).toBe("equal");
    expect(match("\\dfrac{1}{2}\\cdot x", "x/2")).toBe("equal");
    expect(match("y = 2x + 1", "2*x + 1")).toBe("equal");
    expect(match("\\ln(x)", "log(x)")).toBe("equal");
    expect(match("√2", "sqrt(2)")).toBe("equal");
    expect(match("x²", "x**2")).toBe("equal");
  });

  it("calls a rounded decimal close, not wrong", () => {
    expect(match("0.333", "1/3")).toBe("close");
    expect(match("3.14", "pi")).toBe("close");
  });

  it("says when it can't read a side, and which", () => {
    expect(compare("x +", "2")).toEqual({ match: "unreadable", side: "user" });
    expect(compare("2", "x ===")).toEqual({ match: "unreadable", side: "model" });
    expect(match("x < 3", "x")).toBe("unreadable");
    expect(match("the answer is 4", "4")).toBe("unreadable");
    expect(match("", "4")).toBe("unreadable");
  });

  it("can't be made to run code through the answer text", () => {
    expect(match("__import__('os').system('echo hacked')", "1")).not.toBe("equal");
  });
});
