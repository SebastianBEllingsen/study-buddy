import { describe, expect, it } from "vitest";
import { ANSWER_HINT, answerLatex, answerText, checkAnswer, type Answer } from "./answer";
import { add, eq, frac, fracToString, mul, sub, toNumber, type Fraction } from "./fraction";
import { GENERATORS, makeDrill, randomDrill, TOPIC_NAMES, type Drill } from "./generators";
import { evaluate, poly } from "./poly";
import { basisState, mulberry32, probabilities, run, type State } from "../quantum/simulate";

const SEEDS = 300;
const F = frac;
const num = (a: Answer) => toNumber((a as { value: Fraction }).value);
const vec = (a: Answer) => (a as { value: Fraction[] }).value;
const d = (x: unknown) => x as Record<string, number>;

// A wrong answer of the same kind, as text a learner could type.
function perturbed(a: Answer): string {
  switch (a.kind) {
    case "fraction": return fracToString(add(a.value, F(1)));
    case "vector":
    case "set": return [add(a.value[0], F(1)), ...a.value.slice(1)].map(fracToString).join(", ");
    case "gaussian": return `${fracToString(add(a.value.re, F(1)))} + ${fracToString(a.value.im)}i`;
    case "poly": return `${answerText(a)} + x^7`;
  }
}

// Builds a qubit state from amplitudes, for cross-checking with the simulator.
function qubit(a0: [number, number], a1: [number, number], norm: number): State {
  const s = basisState(1);
  s.re[0] = a0[0] / norm; s.im[0] = a0[1] / norm;
  s.re[1] = a1[0] / norm; s.im[1] = a1[1] / norm;
  return s;
}
const PHASE: Record<string, [number, number]> = { "1": [1, 0], "-1": [-1, 0], i: [0, 1], "-i": [0, -1] };

// Each drill's answer, recomputed another way.
const verify: Record<string, (drill: Drill) => void> = {
  det2: ({ data, answer }) => {
    const { a, b, c, e = 0 } = d(data); const dd = d(data).d;
    expect(num(answer)).toBe(a * dd - b * c + e);
  },
  solve2: ({ data, answer }) => {
    const { a, b, c, e, f } = d(data); const dd = d(data).d;
    const [x, y] = vec(answer);
    expect(eq(add(mul(F(a), x), mul(F(b), y)), F(e))).toBe(true);
    expect(eq(add(mul(F(c), x), mul(F(dd), y)), F(f))).toBe(true);
    expect(a * dd - b * c).not.toBe(0);
  },
  matvec: ({ data, answer }) => {
    const { m, v } = data as { m: number[][]; v: number[] };
    // (+ 0 turns a computed -0 into 0.)
    expect(vec(answer).map(toNumber)).toEqual([m[0][0] * v[0] + m[0][1] * v[1] + 0, m[1][0] * v[0] + m[1][1] * v[1] + 0]);
  },
  eigen2: ({ data, answer }) => {
    const { A, l1, l2 } = data as { A: number[][]; l1: number; l2: number };
    for (const l of [l1, l2]) expect((A[0][0] - l) * (A[1][1] - l) - A[0][1] * A[1][0] + 0).toBe(0);
    expect(l1).not.toBe(l2);
    expect(A[0][0] + A[1][1] + 0).toBe(l1 + l2 + 0);
    expect(A[0][0] * A[1][1] - A[0][1] * A[1][0] + 0).toBe(l1 * l2 + 0);
    expect(vec(answer).map(toNumber).sort((x, y) => x - y)).toEqual([l1, l2].sort((x, y) => x - y));
  },
  dot3: ({ data, answer }) => {
    const { u, v } = data as unknown as { u: number[]; v: number[] };
    expect(num(answer)).toBe(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
  },
  derivative: ({ data, answer }) => {
    const f = poly((data.terms as [number, number][]).map(([deg, c]) => [deg, c]));
    const df = (answer as { value: Parameters<typeof evaluate>[0] }).value;
    for (const x of [0.7, -1.3, 2.1]) {
      const h = 1e-5;
      const numeric = (toNumber(evaluate(f, F(Math.round((x + h) * 1e5), 1e5))) - toNumber(evaluate(f, F(Math.round((x - h) * 1e5), 1e5)))) / (2 * h);
      expect(toNumber(evaluate(df, F(Math.round(x * 1e5), 1e5)))).toBeCloseTo(numeric, 3);
    }
  },
  "definite-integral": ({ data, answer }) => {
    const f = poly((data.terms as [number, number][]).map(([deg, c]) => [deg, c]));
    const { lo, hi } = d(data);
    const at = (x: number) => [...f].reduce((s, [deg, c]) => s + toNumber(c) * x ** deg, 0);
    const n = 2000, h = (hi - lo) / n;
    let simpson = at(lo) + at(hi);
    for (let i = 1; i < n; i++) simpson += (i % 2 ? 4 : 2) * at(lo + i * h);
    expect(num(answer)).toBeCloseTo((simpson * h) / 3, 6);
  },
  "chain-rule": ({ data, answer }) => {
    const { n, a, b, x0 } = d(data);
    const f = (x: number) => (a * x + b) ** n;
    const h = 1e-5;
    expect(num(answer)).toBeCloseTo((f(x0 + h) - f(x0 - h)) / (2 * h), 3);
  },
  "turning-point": ({ data, answer }) => {
    const { a, b } = d(data);
    const x = (answer as { value: Fraction }).value;
    expect(eq(add(mul(F(2 * a), x), F(b)), F(0))).toBe(true);
  },
  euler: ({ data, answer }) => {
    const { p, q, y0 } = d(data);
    const h = (data.h as unknown as number[])[0] / (data.h as unknown as number[])[1];
    let y = y0, t = 0;
    for (let i = 0; i < 2; i++) { y += h * (p * y + q * t); t += h; }
    expect(num(answer)).toBeCloseTo(y, 10);
  },
  equilibrium: ({ data, answer }) => {
    const { a, b } = d(data);
    expect(eq(sub(F(a), mul(F(b), (answer as { value: Fraction }).value)), F(0))).toBe(true);
  },
  "logistic-equilibria": ({ data, answer }) => {
    const { rate, K } = d(data);
    for (const y of vec(answer)) expect(toNumber(mul(mul(F(rate), y), sub(F(1), mul(y, F(1, K)))))).toBe(0);
    expect(vec(answer).map(toNumber).sort((x, y) => x - y)).toEqual([0, K]);
  },
  "markov-step": ({ data, answer }) => {
    const P = (data.P as unknown as number[][][]).map((row) => row.map(([n, dd]) => n / dd));
    let x = data.start === 0 ? [1, 0] : [0, 1];
    for (let i = 0; i < 2; i++) x = [x[0] * P[0][0] + x[1] * P[1][0], x[0] * P[0][1] + x[1] * P[1][1]];
    vec(answer).forEach((c, i) => expect(toNumber(c)).toBeCloseTo(x[i], 12));
    expect(toNumber(add(vec(answer)[0], vec(answer)[1]))).toBeCloseTo(1, 12);
  },
  "markov-stationary": ({ data, answer }) => {
    const P = (data.P as unknown as number[][][]).map((row) => row.map(([n, dd]) => n / dd));
    const pi = vec(answer).map(toNumber);
    expect(pi[0] * P[0][0] + pi[1] * P[1][0]).toBeCloseTo(pi[0], 12);
    expect(pi[0] * P[0][1] + pi[1] * P[1][1]).toBeCloseTo(pi[1], 12);
    expect(pi[0] + pi[1]).toBeCloseTo(1, 12);
  },
  recurrence: ({ data, answer }) => {
    const { c, p0 } = d(data);
    const rate = (data.rate as unknown as number[])[0] / (data.rate as unknown as number[])[1];
    let p = p0;
    for (let i = 0; i < 3; i++) p = rate * p + c;
    expect(num(answer)).toBeCloseTo(p, 10);
  },
  "qubit-probability": ({ data, answer }) => {
    const { a, b, N, outcome } = d(data); const phase = data.phase as unknown as string;
    expect(a * a + b * b).toBe(N * N); // a genuine quantum state
    expect(probabilities(qubit([a, 0], [PHASE[phase][0] * b, PHASE[phase][1] * b], N))[outcome]).toBeCloseTo(num(answer), 12);
  },
  "qubit-expectation-z": ({ data, answer }) => {
    const { a, b, N } = d(data); const phase = data.phase as unknown as string;
    const p = probabilities(qubit([a, 0], [PHASE[phase][0] * b, PHASE[phase][1] * b], N));
    expect(p[0] - p[1]).toBeCloseTo(num(answer), 12);
  },
  "qubit-after-hadamard": ({ data, answer }) => {
    const { a, b } = d(data);
    const out = run({ qubits: 1, ops: [{ gate: "H", column: 0, qubits: [0] }] }, qubit([a, 0], [b, 0], Math.sqrt(a * a + b * b)));
    expect(probabilities(out)[0]).toBeCloseTo(num(answer), 12);
  },
  "inner-product": ({ data, answer }) => {
    const { alpha, beta } = data as unknown as { alpha: number[][]; beta: number[][] };
    let re = 0, im = 0;
    for (let k = 0; k < 2; k++) {
      const [ar, ai] = alpha[k], [br, bi] = beta[k];
      re += ar * br + ai * bi; // conj(α)·β
      im += ar * bi - ai * br;
    }
    const got = (answer as { value: { re: Fraction; im: Fraction } }).value;
    expect([toNumber(got.re), toNumber(got.im)]).toEqual([re, im]);
  },
  "tensor-amplitude": ({ data, answer }) => {
    const { first, N, M, i, j } = data as unknown as { first: number[]; N: number; M: number; i: number; j: number };
    const second = data.second as unknown as number[];
    const amps: number[] = [];
    for (const x of [0, 1]) for (const y of [0, 1]) amps.push((first[x] / N) * (second[y] / M));
    expect(num(answer)).toBeCloseTo(amps[i * 2 + j], 12);
    expect(amps.reduce((s, v) => s + v * v, 0)).toBeCloseTo(1, 12); // the product state is normalised
  },
};

describe("every drill", () => {
  it("has a check for each generator, and unique ids", () => {
    expect(Object.keys(verify).sort()).toEqual(GENERATORS.map((g) => g.id).sort());
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
    for (const g of GENERATORS) expect(TOPIC_NAMES[g.topic], g.id).toBeTruthy();
  });

  for (const generator of GENERATORS) {
    describe(generator.id, () => {
      const drills = Array.from({ length: SEEDS }, (_, i) => makeDrill(generator.id, i + 1));

      it("always has the right answer, found another way", () => {
        for (const drill of drills) {
          try {
            verify[generator.id](drill);
          } catch (err) {
            throw new Error(`seed ${drill.seed}: ${(err as Error).message}`);
          }
        }
      });

      it("accepts its own answer, and refuses a wrong one", () => {
        for (const drill of drills) {
          expect(checkAnswer(drill.answer, answerText(drill.answer)), `seed ${drill.seed}`).toBe("correct");
          expect(checkAnswer(drill.answer, perturbed(drill.answer)), `seed ${drill.seed}`).not.toBe("correct");
        }
      });

      it("is repeatable from its seed, and varies between seeds", () => {
        expect(JSON.stringify(makeDrill(generator.id, 7))).toBe(JSON.stringify(makeDrill(generator.id, 7)));
        expect(new Set(drills.map((x) => x.statement)).size).toBeGreaterThan(20);
      });

      it("is well formed: balanced maths, no stray values, a worked solution", () => {
        for (const drill of drills) {
          for (const text of [drill.statement, ...drill.solution]) {
            expect(text.split("$").length % 2, `seed ${drill.seed}: ${text}`).toBe(1);
            expect(text).not.toMatch(/NaN|undefined|\[object|Infinity/);
          }
          expect(drill.solution.length).toBeGreaterThan(0);
          expect(answerLatex(drill.answer)).not.toMatch(/NaN|undefined/);
          expect(ANSWER_HINT[drill.answer.kind]).toBeTruthy();
        }
      });
    });
  }
});

describe("checkAnswer", () => {
  const fraction: Answer = { kind: "fraction", value: F(3, 4) };

  it("takes a fraction as a fraction or an exact decimal, and calls a rounded decimal close", () => {
    expect(checkAnswer(fraction, "3/4")).toBe("correct");
    expect(checkAnswer(fraction, " 6 / 8 ")).toBe("correct");
    expect(checkAnswer(fraction, "0.75")).toBe("correct");
    expect(checkAnswer(fraction, "0.7")).toBe("wrong");
    expect(checkAnswer({ kind: "fraction", value: F(1, 3) }, "0.333")).toBe("close");
    expect(checkAnswer({ kind: "fraction", value: F(1, 3) }, "0.3")).toBe("wrong");
    expect(checkAnswer({ kind: "fraction", value: F(1, 3) }, "1/2")).toBe("wrong");
    expect(checkAnswer(fraction, "three quarters")).toBe("unreadable");
    expect(checkAnswer(fraction, "")).toBe("unreadable");
  });

  it("takes vectors in brackets or without, and sets in any order", () => {
    const vector: Answer = { kind: "vector", value: [F(2), F(-1, 2)] };
    for (const good of ["2, -1/2", "(2, -0.5)", "[2; -1/2]", "{2,-1/2}", "<2, -1/2>"]) expect(checkAnswer(vector, good), good).toBe("correct");
    expect(checkAnswer(vector, "-1/2, 2")).toBe("wrong");
    expect(checkAnswer(vector, "2")).toBe("wrong");
    expect(checkAnswer(vector, "2, -1/2, 3")).toBe("wrong");
    expect(checkAnswer(vector, "2, x")).toBe("unreadable");
    const set: Answer = { kind: "set", value: [F(2), F(5)] };
    expect(checkAnswer(set, "5, 2")).toBe("correct");
    expect(checkAnswer(set, "{2, 5}")).toBe("correct");
    expect(checkAnswer(set, "2, 2")).toBe("wrong");
  });

  it("takes complex numbers and polynomials in the forms a student writes", () => {
    const z: Answer = { kind: "gaussian", value: { re: F(3), im: F(-4) } };
    for (const good of ["3-4i", "3 - 4i", "-4i+3", "−4i + 3"]) expect(checkAnswer(z, good), good).toBe("correct");
    expect(checkAnswer(z, "3+4i")).toBe("wrong");
    expect(checkAnswer(z, "3 -")).toBe("unreadable");
    const p: Answer = { kind: "poly", value: poly([[2, 3], [1, -4], [0, 1]]) };
    for (const good of ["3x^2 - 4x + 1", "1 - 4x + 3x^2", "3*x**2-4*x+1", "3x²−4x+1"]) expect(checkAnswer(p, good), good).toBe("correct");
    expect(checkAnswer(p, "3x^2 - 4x")).toBe("wrong");
    expect(checkAnswer(p, "sin(x)")).toBe("unreadable");
  });
});

describe("randomDrill", () => {
  it("draws from the chosen topic, and doesn't repeat a kind when it has a choice", () => {
    const random = mulberry32(5);
    let previous: string | undefined;
    for (let i = 0; i < 200; i++) {
      const drill = randomDrill("quantum", random, previous);
      expect(drill.topic).toBe("quantum");
      expect(drill.generator).not.toBe(previous);
      previous = drill.generator;
    }
    expect(new Set(Array.from({ length: 300 }, () => randomDrill("all", random).topic)).size).toBe(4);
  });

  it("is repeatable from a seeded source", () => {
    expect(JSON.stringify(randomDrill("all", mulberry32(9)))).toBe(JSON.stringify(randomDrill("all", mulberry32(9))));
  });
});
