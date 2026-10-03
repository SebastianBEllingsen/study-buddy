import {
  ceq, eq, gaussianToLatex, frac, fracToLatex, fracToString, parseFraction, parseGaussian, toNumber, sub, isZero,
  type Fraction, type Gaussian,
} from "./fraction";
import { parsePoly, polyEq, polyToLatex, type Poly } from "./poly";

// What a drill's answer is, how to read what a learner typed, and whether it
// matches. Answers are exact: a number is right or it isn't.

export type Answer =
  | { kind: "fraction"; value: Fraction }
  | { kind: "vector"; value: Fraction[] }
  | { kind: "set"; value: Fraction[] }
  | { kind: "gaussian"; value: Gaussian }
  | { kind: "poly"; value: Poly };

// "close": a decimal within 1% of a right fraction — probably rounded, so the
// exact value is still wanted.
export type Verdict = "correct" | "close" | "wrong" | "unreadable";

export const ANSWER_HINT: Record<Answer["kind"], string> = {
  fraction: "A number or fraction, like 3/4 or -2.",
  vector: "Components separated by commas, like 2, -1.",
  set: "The values separated by commas, in any order, like 2, 5.",
  gaussian: "A complex number, like 3 + 4i or -i.",
  poly: "A polynomial in x, like 3x^2 - 4x + 1.",
};

// The answer as LaTeX, for showing the solution.
export function answerLatex(a: Answer): string {
  switch (a.kind) {
    case "fraction": return fracToLatex(a.value);
    case "vector": return `\\left(${a.value.map(fracToLatex).join(",\\ ")}\\right)`;
    case "set": return `\\{${[...a.value].sort(byValue).map(fracToLatex).join(",\\ ")}\\}`;
    case "gaussian": return gaussianToLatex(a.value);
    case "poly": return polyToLatex(a.value);
  }
}

// The answer as something a learner could type — what `checkAnswer` accepts.
export function answerText(a: Answer): string {
  switch (a.kind) {
    case "fraction": return fracToString(a.value);
    case "vector": return a.value.map(fracToString).join(", ");
    case "set": return [...a.value].sort(byValue).map(fracToString).join(", ");
    case "gaussian": return `${fracToString(a.value.re)} ${a.value.im.n < 0 ? "-" : "+"} ${fracToString(frac(Math.abs(a.value.im.n), a.value.im.d))}i`;
    case "poly": return [...a.value].sort(([x], [y]) => y - x).map(([d, c]) => `${c.n < 0 ? "-" : "+"} ${fracToString(frac(Math.abs(c.n), c.d))}${d === 0 ? "" : d === 1 ? "x" : `x^${d}`}`).join(" ") || "0";
  }
}

const byValue = (a: Fraction, b: Fraction) => toNumber(a) - toNumber(b);

// "(1, 2)", "1, 2", "[1; 2]", "{1,2}" → the numbers, or null if any is unreadable.
function parseList(text: string): Fraction[] | null {
  const inner = text.trim().replace(/^[([{<]\s*/, "").replace(/\s*[)\]}>]$/, "");
  if (!inner.trim()) return null;
  const parts = inner.split(/[,;]/);
  const values = parts.map((p) => parseFraction(p));
  return values.every((v): v is Fraction => v !== null) ? values : null;
}

export function checkAnswer(expected: Answer, input: string): Verdict {
  switch (expected.kind) {
    case "fraction": {
      const got = parseFraction(input);
      if (!got) return "unreadable";
      if (eq(got, expected.value)) return "correct";
      const off = Math.abs(toNumber(sub(got, expected.value)));
      return input.includes(".") && off / Math.max(1, Math.abs(toNumber(expected.value))) < 0.01 && !isZero(got) ? "close" : "wrong";
    }
    case "vector":
    case "set": {
      const got = parseList(input);
      if (!got) return "unreadable";
      const want = expected.kind === "set" ? [...expected.value].sort(byValue) : expected.value;
      const have = expected.kind === "set" ? [...got].sort(byValue) : got;
      return want.length === have.length && want.every((w, i) => eq(w, have[i])) ? "correct" : "wrong";
    }
    case "gaussian": {
      const got = parseGaussian(input);
      return got ? (ceq(got, expected.value) ? "correct" : "wrong") : "unreadable";
    }
    case "poly": {
      const got = parsePoly(input);
      return got ? (polyEq(got, expected.value) ? "correct" : "wrong") : "unreadable";
    }
  }
}
