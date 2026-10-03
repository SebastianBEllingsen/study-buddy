import type { FinalMatch } from "./types";

// Comparing a learner's final answer with a problem's model answer the way a
// person would: is it the same quantity, in whatever form? That's computer
// algebra (SymPy), not a language model's opinion, so it runs in the same
// in-browser Python as the code exercises (lib/code/runner.ts) — the learner's
// text never goes anywhere but that sandbox.
//
// Answers are read as plain math (2*x + 1, sqrt(3)/2, 3/4, x^2) or simple
// LaTeX (\frac{3}{4}, \sqrt{2}, x^{2}, \pi). Anything it can't read — a proof,
// a set, an equation — comes back "unreadable", and the AI alone judges.
//
// Checks are numeric, by design: the two expressions are evaluated at a few
// points and compared, which is fast and can't hang on an expression SymPy
// would spend minutes simplifying. The only guess it makes is that two
// expressions agreeing at every sampled point are equal.

export const MATCHES: FinalMatch[] = ["equal", "close", "different", "unreadable"];

export const MATH_COMPARE_PYTHON = String.raw`
import json, re, random
import sympy as sp
from sympy.parsing.sympy_parser import (
    parse_expr, standard_transformations, implicit_multiplication_application, convert_xor,
)

__TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)
__NAMES = {"e": sp.E}

def __latex_to_text(s):
    s = s.replace("$", "")
    s = re.sub("\u221a\\s*\\(", "sqrt(", s)
    s = re.sub("\u221a\\s*([A-Za-z0-9.]+)", r"sqrt(\1)", s)
    for old, new in (("\u2212", "-"), ("\u00d7", "*"), ("\u00b7", "*"), ("\u03c0", "pi"), ("\u00b2", "**2"), ("\u00b3", "**3")):
        s = s.replace(old, new)
    s = re.sub(r"\\(left|right|displaystyle)\b", "", s)
    s = s.replace("\\cdot", "*").replace("\\times", "*").replace("\\,", " ").replace("\\!", "").replace("\\ ", " ")
    frac = re.compile(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}")
    sqrt = re.compile(r"\\sqrt\s*\{([^{}]*)\}")
    power = re.compile(r"\^\s*\{([^{}]*)\}")
    sub = re.compile(r"_\s*\{([^{}]*)\}")
    while True:
        new = frac.sub(lambda m: "((" + m.group(1) + ")/(" + m.group(2) + "))", s)
        new = sqrt.sub(lambda m: "sqrt(" + m.group(1) + ")", new)
        new = power.sub(lambda m: "**(" + m.group(1) + ")", new)
        new = sub.sub(lambda m: "_" + m.group(1), new)
        if new == s:
            break
        s = new
    s = re.sub(r"\\ln\b", "log", s)
    s = re.sub(r"\\infty\b", "oo", s)
    s = re.sub(r"\\([A-Za-z]+)", r"\1", s)
    return s.replace("{", "(").replace("}", ")").strip()

def __parse(text):
    s = __latex_to_text(text)
    match = re.match(r"^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$", s)
    if match:
        s = match.group(2)
    if re.search(r"[<>=]", s):
        raise ValueError("not a single expression")
    return parse_expr(s, transformations=__TRANSFORMS, local_dict=dict(__NAMES))

def __close(x, y, rel):
    return abs(x - y) <= rel * max(1.0, abs(y))

def __number(expr):
    value = complex(sp.N(expr, 30))
    if value != value or abs(value) == float("inf"):
        raise ValueError("not a finite number")
    return value

def __compare(a, b, user_has_float):
    symbols = sorted(a.free_symbols | b.free_symbols, key=str)
    if not symbols:
        x, y = __number(a), __number(b)
        if __close(x, y, 1e-9):
            return "equal"
        if user_has_float and __close(x, y, 1e-2):
            return "close"
        return "different"
    rng = random.Random(7)
    agreed = 0
    for _ in range(10):
        point = {s: sp.Float(rng.uniform(0.5, 3.0)) for s in symbols}
        try:
            x, y = __number(a.subs(point)), __number(b.subs(point))
        except Exception:
            continue
        agreed += 1
        if not __close(x, y, 1e-7):
            return "different"
    return "equal" if agreed >= 3 else "unreadable"

def __run(user, model):
    try:
        a = __parse(user)
    except Exception:
        return {"match": "unreadable", "side": "user"}
    try:
        b = __parse(model)
    except Exception:
        return {"match": "unreadable", "side": "model"}
    try:
        return {"match": __compare(a, b, a.has(sp.Float) or bool(re.search(r"\d\.\d", user)))}
    except Exception:
        return {"match": "unreadable", "side": "user"}

print(json.dumps(__run(__args["user"], __args["model"])))
`;

// The program for one comparison: the two texts go in as data, never spliced
// into the code.
export function buildCompareProgram(user: string, model: string): string {
  return `import json\n__args = json.loads(${JSON.stringify(JSON.stringify({ user, model }))})\n${MATH_COMPARE_PYTHON}`;
}

export interface CompareOutcome {
  match: FinalMatch;
  // When "unreadable": which text couldn't be read.
  side?: "user" | "model";
}

export function parseCompareOutput(stdout: string): CompareOutcome {
  try {
    const out = JSON.parse(stdout.trim().split("\n").pop() ?? "") as { match?: unknown; side?: unknown };
    const match = MATCHES.find((m) => m === out.match);
    if (match) return { match, ...(out.side === "user" || out.side === "model" ? { side: out.side } : {}) };
  } catch {
    // fall through
  }
  return { match: "unreadable" };
}

// In the browser only: runs the comparison in the code runner's sandbox.
export async function compareFinalAnswers(user: string, model: string): Promise<CompareOutcome> {
  const { runTests } = await import("../code/runner");
  const run = await runTests("python", buildCompareProgram(user, model), []);
  return run.error ? { match: "unreadable" } : parseCompareOutput(run.stdout);
}
