import { mulberry32 } from "../quantum/simulate";
import type { Answer } from "./answer";
import { answerLatex } from "./answer";
import { add, cadd, cmul, conj, cx, div, frac, fracToLatex, gaussianToLatex, mul, sub, ZERO, type Fraction, type Gaussian } from "./fraction";
import { antiderivative, derivative, evaluate, poly, polyToLatex } from "./poly";

// Drills: practice problems with fresh numbers every time and answers worked
// out in code, exactly — so a right answer is provably right, and there's
// never a wrong answer key. Text is LaTeX between $…$ for MathText.

export type Topic = "algebra" | "calculus" | "modelling" | "quantum";

export const TOPIC_NAMES: Record<Topic, string> = {
  algebra: "Linear algebra",
  calculus: "Calculus",
  modelling: "Modelling",
  quantum: "Quantum",
};

export interface Drill {
  generator: string;
  seed: number;
  topic: Topic;
  title: string;
  statement: string;
  answer: Answer;
  // The worked solution, a step at a time.
  solution: string[];
  // The numbers the problem was built from, for tests that check the answer
  // another way.
  data: Record<string, unknown>;
}

type Rng = () => number;
type Made = Pick<Drill, "statement" | "answer" | "solution" | "data">;

export interface Generator {
  id: string;
  topic: Topic;
  title: string;
  make(rng: Rng): Made;
}

// ---- Small helpers ---------------------------------------------------------

const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const nonzero = (r: Rng, lo: number, hi: number) => {
  let v = 0;
  while (v === 0) v = int(r, lo, hi);
  return v;
};
const pick = <T,>(r: Rng, xs: T[]): T => xs[Math.floor(r() * xs.length)];

// A number in an expression, in brackets when negative: (-3).
const paren = (n: number) => (n < 0 ? `(${n})` : `${n}`);

// 2x - 3y, leaving out zero terms: linear([2, -3], ["x", "y"]).
function linear(coefficients: number[], names: string[]): string {
  const parts: string[] = [];
  coefficients.forEach((c, i) => {
    if (c === 0) return;
    const magnitude = Math.abs(c) === 1 ? "" : String(Math.abs(c));
    const body = `${magnitude}${names[i]}`;
    parts.push(parts.length === 0 ? `${c < 0 ? "-" : ""}${body}` : ` ${c < 0 ? "-" : "+"} ${body}`);
  });
  return parts.join("") || "0";
}

// ax + b: affine(2, -3) is "2x - 3".
function affine(a: number, b: number): string {
  const head = linear([a], ["x"]);
  return b === 0 ? head : `${head} ${b < 0 ? "-" : "+"} ${Math.abs(b)}`;
}

const matrix = (rows: (Fraction | number)[][]) =>
  `\\begin{pmatrix} ${rows.map((row) => row.map((v) => (typeof v === "number" ? v : fracToLatex(v))).join(" & ")).join(" \\\\ ")} \\end{pmatrix}`;

const column = (values: (Fraction | number)[]) => matrix(values.map((v) => [v]));

const F = frac;
const tex = (s: string) => `$${s}$`;

// A right triangle's sides: a²+b² = c², so a state (a|0⟩ + b|1⟩)/c has
// probabilities that are fractions.
const TRIPLES: [number, number, number][] = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [6, 8, 10]];

// The coefficient of a ket, written out: 3, -4i, i.
function ketCoefficient(magnitude: number, phase: "1" | "-1" | "i" | "-i"): string {
  const m = magnitude === 1 ? "" : String(magnitude);
  return phase === "1" ? m : phase === "-1" ? `-${m}` : phase === "i" ? `${m}i` : `-${m}i`;
}

// A qubit state as text: (a|0⟩ + b|1⟩), with signs and phases looked after.
function qubitSum(first: string, second: string): string {
  const joined = second.startsWith("-") ? `${first}|0\\rangle - ${second.slice(1)}|1\\rangle` : `${first}|0\\rangle + ${second}|1\\rangle`;
  return joined;
}

// ---- The generators --------------------------------------------------------

export const GENERATORS: Generator[] = [
  // Linear algebra
  {
    id: "det2",
    topic: "algebra",
    title: "2×2 determinant",
    make(r) {
      const [a, b, c, d] = [int(r, -6, 6), int(r, -6, 6), int(r, -6, 6), int(r, -6, 6)];
      const value = a * d - b * c;
      return {
        statement: `Find ${tex(`\\det ${matrix([[a, b], [c, d]])}`)}.`,
        answer: { kind: "fraction", value: F(value) },
        solution: [
          tex("\\det = ad - bc"),
          tex(`= (${a})(${d}) - (${b})(${c}) = ${a * d} - ${paren(b * c)}`),
          tex(`= ${value}`),
        ],
        data: { a, b, c, d },
      };
    },
  },
  {
    id: "solve2",
    topic: "algebra",
    title: "Two equations, two unknowns",
    make(r) {
      let a: number, b: number, c: number, d: number, det: number;
      do {
        [a, b, c, d] = [int(r, -5, 5), int(r, -5, 5), int(r, -5, 5), int(r, -5, 5)];
        det = a * d - b * c;
      } while (det === 0 || Math.abs(det) > 9);
      const [e, f] = [int(r, -9, 9), int(r, -9, 9)];
      const x = F(e * d - b * f, det), y = F(a * f - e * c, det);
      return {
        statement: `Solve ${tex(`${linear([a, b], ["x", "y"])} = ${e}`)} and ${tex(`${linear([c, d], ["x", "y"])} = ${f}`)}. Give ${tex("(x, y)")}.`,
        answer: { kind: "vector", value: [x, y] },
        solution: [
          tex(`D = ad - bc = (${a})(${d}) - (${b})(${c}) = ${det}`),
          tex(`x = \\frac{ed - bf}{D} = \\frac{(${e})(${d}) - (${b})(${f})}{${det}} = ${fracToLatex(x)}`),
          tex(`y = \\frac{af - ec}{D} = \\frac{(${a})(${f}) - (${e})(${c})}{${det}} = ${fracToLatex(y)}`),
        ],
        data: { a, b, c, d, e, f },
      };
    },
  },
  {
    id: "matvec",
    topic: "algebra",
    title: "Matrix times vector",
    make(r) {
      const m = [[int(r, -4, 4), int(r, -4, 4)], [int(r, -4, 4), int(r, -4, 4)]];
      const v = [int(r, -4, 4), int(r, -4, 4)];
      const out = m.map((row) => row[0] * v[0] + row[1] * v[1]);
      return {
        statement: `Compute ${tex(`${matrix(m)}${column(v)}`)}. Give the two components.`,
        answer: { kind: "vector", value: out.map((x) => F(x)) },
        solution: m.map((row, i) => tex(`\\text{row } ${i + 1}:\\ (${row[0]})(${v[0]}) + (${row[1]})(${v[1]}) = ${out[i]}`)),
        data: { m, v },
      };
    },
  },
  {
    id: "eigen2",
    topic: "algebra",
    title: "Eigenvalues of a 2×2 matrix",
    make(r) {
      const l1 = int(r, -5, 5);
      let l2 = l1;
      while (l2 === l1) l2 = int(r, -5, 5);
      const p = int(r, -2, 2), q = int(r, -2, 2);
      // A = P·diag(l1, l2)·P⁻¹ with det P = 1, so A has whole-number entries.
      const P = [[1, p], [q, 1 + p * q]];
      const Pinv = [[1 + p * q, -p], [-q, 1]];
      const PD = [[P[0][0] * l1, P[0][1] * l2], [P[1][0] * l1, P[1][1] * l2]];
      const A = [0, 1].map((i) => [0, 1].map((j) => PD[i][0] * Pinv[0][j] + PD[i][1] * Pinv[1][j]));
      const trace = A[0][0] + A[1][1];
      const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
      return {
        statement: `Find both eigenvalues of ${tex(matrix(A))}.`,
        answer: { kind: "set", value: [F(l1), F(l2)] },
        solution: [
          tex(`\\lambda^2 - (\\operatorname{tr}A)\\lambda + \\det A = 0`),
          tex(`\\operatorname{tr}A = ${trace},\\quad \\det A = ${det}`),
          tex(`\\lambda^2 - ${paren(trace)}\\lambda + ${paren(det)} = (\\lambda - ${paren(l1)})(\\lambda - ${paren(l2)}) = 0`),
          tex(`\\lambda = ${l1},\\ ${l2}`),
        ],
        data: { A, l1, l2 },
      };
    },
  },
  {
    id: "dot3",
    topic: "algebra",
    title: "Dot product",
    make(r) {
      const u = [int(r, -5, 5), int(r, -5, 5), int(r, -5, 5)];
      const v = [int(r, -5, 5), int(r, -5, 5), int(r, -5, 5)];
      const value = u.reduce((s, x, i) => s + x * v[i], 0);
      return {
        statement: `Compute ${tex(`${column(u)} \\cdot ${column(v)}`)}.`,
        answer: { kind: "fraction", value: F(value) },
        solution: [
          tex(`= ${u.map((x, i) => `(${x})(${v[i]})`).join(" + ")}`),
          tex(`= ${u.map((x, i) => paren(x * v[i])).join(" + ")} = ${value}`),
        ],
        data: { u, v },
      };
    },
  },

  // Calculus
  {
    id: "derivative",
    topic: "calculus",
    title: "Differentiate a polynomial",
    make(r) {
      const degree = int(r, 2, 3);
      const terms: [number, number][] = [[degree, nonzero(r, -6, 6)]];
      for (let d = degree - 1; d >= 0; d--) terms.push([d, int(r, -6, 6)]);
      const f = poly(terms);
      const df = derivative(f);
      return {
        statement: `Differentiate ${tex(`f(x) = ${polyToLatex(f)}`)}. Give ${tex("f'(x)")}.`,
        answer: { kind: "poly", value: df },
        solution: [
          tex("\\frac{d}{dx}\\left(c\\,x^n\\right) = n c\\,x^{n-1}"),
          tex(`f'(x) = ${polyToLatex(df)}`),
        ],
        data: { terms: [...f].map(([d, c]) => [d, c.n]) },
      };
    },
  },
  {
    id: "definite-integral",
    topic: "calculus",
    title: "Definite integral",
    make(r) {
      const degree = int(r, 1, 2);
      const terms: [number, number][] = [[degree, nonzero(r, -4, 4)]];
      for (let d = degree - 1; d >= 0; d--) terms.push([d, int(r, -4, 4)]);
      const f = poly(terms);
      const lo = int(r, -2, 1);
      const hi = lo + int(r, 1, 3);
      const F_ = antiderivative(f);
      const value = sub(evaluate(F_, F(hi)), evaluate(F_, F(lo)));
      return {
        statement: `Evaluate ${tex(`\\int_{${lo}}^{${hi}} \\left(${polyToLatex(f)}\\right)\\,dx`)}.`,
        answer: { kind: "fraction", value },
        solution: [
          tex(`F(x) = ${polyToLatex(F_)}`),
          tex(`F(${hi}) - F(${lo}) = ${fracToLatex(evaluate(F_, F(hi)))} - ${paren2(evaluate(F_, F(lo)))}`),
          tex(`= ${fracToLatex(value)}`),
        ],
        data: { terms: [...f].map(([d, c]) => [d, c.n]), lo, hi },
      };
    },
  },
  {
    id: "chain-rule",
    topic: "calculus",
    title: "Chain rule at a point",
    make(r) {
      const n = int(r, 2, 4);
      const a = nonzero(r, -3, 3), b = int(r, -4, 4), x0 = int(r, -2, 2);
      const inner = a * x0 + b;
      const value = n * a * inner ** (n - 1);
      return {
        statement: `For ${tex(`f(x) = (${affine(a, b)})^{${n}}`)}, find ${tex(`f'(${x0})`)}.`,
        answer: { kind: "fraction", value: F(value) },
        solution: [
          tex(`f'(x) = ${n}\\,(${affine(a, b)})^{${n - 1}} \\cdot ${paren(a)}`),
          tex(`f'(${x0}) = ${n}\\,(${inner})^{${n - 1}} \\cdot ${paren(a)} = ${value}`),
        ],
        data: { n, a, b, x0 },
      };
    },
  },
  {
    id: "turning-point",
    topic: "calculus",
    title: "Where a parabola turns",
    make(r) {
      const a = nonzero(r, -4, 4), b = int(r, -9, 9), c = int(r, -9, 9);
      const f = poly([[2, a], [1, b], [0, c]]);
      const x = F(-b, 2 * a);
      return {
        statement: `The function ${tex(`f(x) = ${polyToLatex(f)}`)} has one turning point. Find its ${tex("x")}-coordinate.`,
        answer: { kind: "fraction", value: x },
        solution: [
          tex(`f'(x) = ${polyToLatex(derivative(f))} = 0`),
          tex(`x = ${fracToLatex(x)}`),
        ],
        data: { a, b, c },
      };
    },
  },

  // Modelling
  {
    id: "euler",
    topic: "modelling",
    title: "Euler's method, two steps",
    make(r) {
      let p = 0, q = 0;
      while (p === 0 && q === 0) [p, q] = [int(r, -3, 3), int(r, -3, 3)];
      const y0 = int(r, -4, 4);
      const h = pick(r, [F(1), F(1, 2), F(1, 4)]);
      const f = (t: Fraction, y: Fraction) => add(mul(F(p), y), mul(F(q), t));
      const y1 = add(F(y0), mul(h, f(ZERO, F(y0))));
      const y2 = add(y1, mul(h, f(h, y1)));
      return {
        statement: `Take two steps of Euler's method with step size ${tex(`h = ${fracToLatex(h)}`)} for ${tex(`\\frac{dy}{dt} = ${linear([p, q], ["y", "t"])},\\ y(0) = ${y0}`)}. Find ${tex("y_2")}.`,
        answer: { kind: "fraction", value: y2 },
        solution: [
          tex("y_{n+1} = y_n + h\\,f(t_n, y_n)"),
          tex(`y_1 = ${y0} + ${fracToLatex(h)}\\,(${linear([p, q], ["(" + y0 + ")", "(0)"])}) = ${fracToLatex(y1)}`),
          tex(`y_2 = ${fracToLatex(y1)} + ${fracToLatex(h)}\\,f(${fracToLatex(h)}, ${fracToLatex(y1)}) = ${fracToLatex(y2)}`),
        ],
        data: { p, q, y0, h: [h.n, h.d] },
      };
    },
  },
  {
    id: "equilibrium",
    topic: "modelling",
    title: "Equilibrium of a linear model",
    make(r) {
      const a = int(r, -8, 8), b = int(r, 1, 6);
      const eq_ = F(a, b);
      return {
        statement: `A model follows ${tex(`\\frac{dy}{dt} = ${a} - ${b}y`.replace("- 1y", "- y"))}. Find the equilibrium value ${tex("y^*")}, where ${tex("dy/dt = 0")}.`,
        answer: { kind: "fraction", value: eq_ },
        solution: [tex(`${a} - ${b}y^* = 0`), tex(`y^* = ${fracToLatex(eq_)}`)],
        data: { a, b },
      };
    },
  },
  {
    id: "logistic-equilibria",
    topic: "modelling",
    title: "Equilibria of logistic growth",
    make(r) {
      const rate = int(r, 1, 4), K = int(r, 2, 12);
      return {
        statement: `Find both equilibria of ${tex(`\\frac{dy}{dt} = ${rate === 1 ? "" : rate}y\\left(1 - \\frac{y}{${K}}\\right)`)}.`,
        answer: { kind: "set", value: [F(0), F(K)] },
        solution: [tex(`${rate === 1 ? "" : rate}y\\left(1 - \\tfrac{y}{${K}}\\right) = 0`), tex(`y = 0 \\quad\\text{or}\\quad y = ${K}`)],
        data: { rate, K },
      };
    },
  },
  {
    id: "markov-step",
    topic: "modelling",
    title: "A Markov chain, two steps",
    make(r) {
      const a = F(int(r, 1, 9), 10), b = F(int(r, 1, 9), 10);
      const P = [[sub(F(1), a), a], [b, sub(F(1), b)]];
      const start = pick(r, [0, 1]);
      let dist: Fraction[] = start === 0 ? [F(1), F(0)] : [F(0), F(1)];
      const step = (x: Fraction[]) => [add(mul(x[0], P[0][0]), mul(x[1], P[1][0])), add(mul(x[0], P[0][1]), mul(x[1], P[1][1]))];
      const d1 = step(dist);
      dist = step(d1);
      return {
        statement: `A two-state chain has transition matrix ${tex(`P = ${matrix(P)}`)}, where row ${tex("i")} gives the probabilities of moving from state ${tex("i")}. It starts in state ${start + 1}. What is the distribution after two steps, as ${tex("(p_1, p_2)")}?`,
        answer: { kind: "vector", value: dist },
        solution: [
          tex(`\\pi_1 = \\pi_0 P = \\left(${d1.map(fracToLatex).join(",\\ ")}\\right)`),
          tex(`\\pi_2 = \\pi_1 P = \\left(${dist.map(fracToLatex).join(",\\ ")}\\right)`),
        ],
        data: { P: P.map((row) => row.map((x) => [x.n, x.d])), start },
      };
    },
  },
  {
    id: "markov-stationary",
    topic: "modelling",
    title: "Long-run distribution of a Markov chain",
    make(r) {
      const a = F(int(r, 1, 9), 10), b = F(int(r, 1, 9), 10);
      const P = [[sub(F(1), a), a], [b, sub(F(1), b)]];
      const total = add(a, b);
      const pi = [div(b, total), div(a, total)];
      return {
        statement: `For the chain with ${tex(`P = ${matrix(P)}`)}, find the long-run distribution ${tex("(\\pi_1, \\pi_2)")}.`,
        answer: { kind: "vector", value: pi },
        solution: [
          tex("\\pi P = \\pi,\\quad \\pi_1 + \\pi_2 = 1"),
          tex(`\\pi_1 \\cdot ${fracToLatex(a)} = \\pi_2 \\cdot ${fracToLatex(b)}`),
          tex(`\\pi = \\left(${pi.map(fracToLatex).join(",\\ ")}\\right)`),
        ],
        data: { P: P.map((row) => row.map((x) => [x.n, x.d])) },
      };
    },
  },
  {
    id: "recurrence",
    topic: "modelling",
    title: "A growth recurrence",
    make(r) {
      const rate = pick(r, [F(2), F(3), F(1, 2), F(3, 2)]);
      const c = int(r, -5, 5), p0 = int(r, 1, 10);
      const next = (p: Fraction) => add(mul(rate, p), F(c));
      const p1 = next(F(p0)), p2 = next(p1), p3 = next(p2);
      return {
        statement: `A population follows ${tex(`P_{n+1} = ${fracToLatex(rate)}\\,P_n ${c < 0 ? "-" : "+"} ${Math.abs(c)}`)} with ${tex(`P_0 = ${p0}`)}. Find ${tex("P_3")}.`,
        answer: { kind: "fraction", value: p3 },
        solution: [tex(`P_1 = ${fracToLatex(p1)}`), tex(`P_2 = ${fracToLatex(p2)}`), tex(`P_3 = ${fracToLatex(p3)}`)],
        data: { rate: [rate.n, rate.d], c, p0 },
      };
    },
  },

  // Quantum
  {
    id: "qubit-probability",
    topic: "quantum",
    title: "Measurement probability",
    make(r) {
      const [x, y, N] = pick(r, TRIPLES);
      const [a, b] = r() < 0.5 ? [x, y] : [y, x];
      const phase = pick(r, ["1", "-1", "i", "-i"] as const);
      const outcome = pick(r, [0, 1]);
      const value = F(outcome === 0 ? a * a : b * b, N * N);
      return {
        statement: `A qubit is in the state ${tex(`|\\psi\\rangle = \\frac{1}{${N}}\\left(${qubitSum(String(a), ketCoefficient(b, phase))}\\right)`)}. What is the probability of measuring ${outcome}?`,
        answer: { kind: "fraction", value },
        solution: [
          tex(`P(${outcome}) = \\left|\\langle ${outcome}|\\psi\\rangle\\right|^2`),
          tex(`= \\left|\\frac{${outcome === 0 ? a : ketCoefficient(b, phase)}}{${N}}\\right|^2 = \\frac{${outcome === 0 ? a * a : b * b}}{${N * N}} = ${fracToLatex(value)}`),
        ],
        data: { a, b, N, phase, outcome },
      };
    },
  },
  {
    id: "qubit-expectation-z",
    topic: "quantum",
    title: "Expectation value of Z",
    make(r) {
      const [x, y, N] = pick(r, TRIPLES);
      const [a, b] = r() < 0.5 ? [x, y] : [y, x];
      const phase = pick(r, ["1", "-1", "i", "-i"] as const);
      const value = F(a * a - b * b, N * N);
      return {
        statement: `For ${tex(`|\\psi\\rangle = \\frac{1}{${N}}\\left(${qubitSum(String(a), ketCoefficient(b, phase))}\\right)`)}, find ${tex("\\langle Z\\rangle = \\langle\\psi|Z|\\psi\\rangle")}.`,
        answer: { kind: "fraction", value },
        solution: [
          tex("\\langle Z\\rangle = P(0) - P(1)"),
          tex(`= \\frac{${a * a}}{${N * N}} - \\frac{${b * b}}{${N * N}} = ${fracToLatex(value)}`),
        ],
        data: { a, b, N, phase },
      };
    },
  },
  {
    id: "qubit-after-hadamard",
    topic: "quantum",
    title: "Probability after a Hadamard",
    make(r) {
      let a = 0, b = 0;
      while (a === 0 && b === 0) [a, b] = [int(r, -4, 4), int(r, -4, 4)];
      const norm = a * a + b * b;
      const value = F((a + b) ** 2, 2 * norm);
      return {
        statement: `A qubit is in the state ${tex(`\\frac{1}{\\sqrt{${norm}}}\\left(${qubitSum(String(a), String(b))}\\right)`)}. After a Hadamard gate, what is the probability of measuring 0?`,
        answer: { kind: "fraction", value },
        solution: [
          tex("H|\\psi\\rangle:\\quad \\text{amplitude of } |0\\rangle = \\frac{\\alpha + \\beta}{\\sqrt{2}}"),
          tex(`P(0) = \\frac{(${a} + ${paren(b)})^2}{2 \\cdot ${norm}} = \\frac{${(a + b) ** 2}}{${2 * norm}} = ${fracToLatex(value)}`),
        ],
        data: { a, b },
      };
    },
  },
  {
    id: "inner-product",
    topic: "quantum",
    title: "Inner product",
    make(r) {
      const g = (): Gaussian => cx(F(int(r, -3, 3)), F(int(r, -3, 3)));
      const alpha = [g(), g()], beta = [g(), g()];
      const value = cadd(cmul(conj(alpha[0]), beta[0]), cmul(conj(alpha[1]), beta[1]));
      const ket = (v: Gaussian[]) => `(${gaussianToLatex(v[0])})|0\\rangle + (${gaussianToLatex(v[1])})|1\\rangle`;
      return {
        statement: `For ${tex(`|\\psi\\rangle = ${ket(alpha)}`)} and ${tex(`|\\phi\\rangle = ${ket(beta)}`)}, find ${tex("\\langle\\psi|\\phi\\rangle")}.`,
        answer: { kind: "gaussian", value },
        solution: [
          tex("\\langle\\psi|\\phi\\rangle = \\overline{\\alpha_0}\\,\\beta_0 + \\overline{\\alpha_1}\\,\\beta_1"),
          tex(`= (${gaussianToLatex(conj(alpha[0]))})(${gaussianToLatex(beta[0])}) + (${gaussianToLatex(conj(alpha[1]))})(${gaussianToLatex(beta[1])})`),
          tex(`= ${gaussianToLatex(value)}`),
        ],
        data: { alpha: alpha.map((z) => [z.re.n, z.im.n]), beta: beta.map((z) => [z.re.n, z.im.n]) },
      };
    },
  },
  {
    id: "tensor-amplitude",
    topic: "quantum",
    title: "Amplitude in a two-qubit product state",
    make(r) {
      const [x1, y1, N] = pick(r, TRIPLES.slice(0, 5));
      const [x2, y2, M] = pick(r, TRIPLES.slice(0, 5));
      const first = r() < 0.5 ? [x1, y1] : [y1, x1];
      const second = r() < 0.5 ? [x2, y2] : [y2, x2];
      const i = int(r, 0, 1), j = int(r, 0, 1);
      const value = F(first[i] * second[j], N * M);
      return {
        statement: `Qubit 1 is in ${tex(`\\frac{1}{${N}}\\left(${qubitSum(String(first[0]), String(first[1]))}\\right)`)} and qubit 2 in ${tex(`\\frac{1}{${M}}\\left(${qubitSum(String(second[0]), String(second[1]))}\\right)`)}. What is the amplitude of ${tex(`|${i}${j}\\rangle`)} in the combined state?`,
        answer: { kind: "fraction", value },
        solution: [
          tex(`\\langle ${i}${j}|\\psi_1\\otimes\\psi_2\\rangle = \\langle ${i}|\\psi_1\\rangle\\,\\langle ${j}|\\psi_2\\rangle`),
          tex(`= \\frac{${first[i]}}{${N}}\\cdot\\frac{${second[j]}}{${M}} = ${fracToLatex(value)}`),
        ],
        data: { first, second, N, M, i, j },
      };
    },
  },
];

// A fraction in brackets when negative, for "F(b) − (negative)".
function paren2(f: Fraction): string {
  return f.n < 0 ? `(${fracToLatex(f)})` : fracToLatex(f);
}

export function generatorById(id: string): Generator | undefined {
  return GENERATORS.find((g) => g.id === id);
}

export function makeDrill(generatorId: string, seed: number): Drill {
  const generator = generatorById(generatorId);
  if (!generator) throw new Error(`No drill called ${generatorId}`);
  return { generator: generator.id, seed, topic: generator.topic, title: generator.title, ...generator.make(mulberry32(seed)) };
}

// A random drill from a topic (or all), not the same kind as `previous` when
// there's a choice.
export function randomDrill(topic: Topic | "all", random: () => number = Math.random, previous?: string): Drill {
  const pool = GENERATORS.filter((g) => topic === "all" || g.topic === topic);
  const choices = pool.length > 1 ? pool.filter((g) => g.id !== previous) : pool;
  const generator = choices[Math.floor(random() * choices.length)];
  return makeDrill(generator.id, Math.floor(random() * 2 ** 31));
}

// The answer as LaTeX for the solution panel.
export function solutionAnswer(drill: Drill): string {
  return tex(answerLatex(drill.answer));
}
