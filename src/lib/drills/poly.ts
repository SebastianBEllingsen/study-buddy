import { ZERO, add, eq, frac, fracToLatex, isZero, mul, neg, parseFraction, type Fraction } from "./fraction";

// Polynomials in x with exact coefficients, for derivative and integral drills.
// Stored as coefficients by degree, without zeros.

export type Poly = Map<number, Fraction>;

export function poly(terms: [number, Fraction | number][]): Poly {
  const p: Poly = new Map();
  for (const [degree, c] of terms) {
    const value = add(p.get(degree) ?? ZERO, typeof c === "number" ? frac(c) : c);
    if (isZero(value)) p.delete(degree);
    else p.set(degree, value);
  }
  return p;
}

export const polyEq = (a: Poly, b: Poly): boolean => a.size === b.size && [...a].every(([d, c]) => b.has(d) && eq(c, b.get(d) as Fraction));

export function derivative(p: Poly): Poly {
  return poly([...p].filter(([d]) => d > 0).map(([d, c]) => [d - 1, mul(c, frac(d))]));
}

export function antiderivative(p: Poly): Poly {
  return poly([...p].map(([d, c]) => [d + 1, mul(c, frac(1, d + 1))]));
}

export function evaluate(p: Poly, x: Fraction): Fraction {
  let total = ZERO;
  for (const [d, c] of p) {
    let power = frac(1);
    for (let i = 0; i < d; i++) power = mul(power, x);
    total = add(total, mul(c, power));
  }
  return total;
}

// 3x^2 - 4x + 1, highest degree first. The zero polynomial is "0".
export function polyToLatex(p: Poly): string {
  if (p.size === 0) return "0";
  const degrees = [...p.keys()].sort((a, b) => b - a);
  return degrees
    .map((d, i) => {
      const c = p.get(d) as Fraction;
      const negative = c.n < 0;
      const magnitude = negative ? neg(c) : c;
      const variable = d === 0 ? "" : d === 1 ? "x" : `x^{${d}}`;
      const coefficient = d !== 0 && eq(magnitude, frac(1)) ? "" : fracToLatex(magnitude);
      const body = `${coefficient}${variable}`;
      return i === 0 ? `${negative ? "-" : ""}${body}` : ` ${negative ? "-" : "+"} ${body}`;
    })
    .join("");
}

const SUPERSCRIPTS: Record<string, string> = { "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5" };

// Reads "3x^2 - 4x + 1", "3*x**2", "x²", "-x", "(1/2)x^2", "1/2 x^2". Null if
// it isn't a polynomial in x with numeric coefficients.
export function parsePoly(text: string): Poly | null {
  let t = text.toLowerCase().replace(/−/g, "-").replace(/[²³⁴⁵]/g, (s) => SUPERSCRIPTS[s]);
  t = t.replace(/\*\*/g, "^").replace(/[\s*]/g, "").replace(/\(([+-]?\d+(?:\/\d+)?)\)/g, "$1");
  if (!t) return null;
  const terms = t.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join("") !== t) return null;
  const parsed: [number, Fraction][] = [];
  for (const term of terms) {
    const m = /^([+-]?)((?:\d+(?:\.\d+)?(?:\/\d+)?)?)(?:(x)(?:\^(\d+))?)?$/.exec(term);
    if (!m || (m[2] === "" && !m[3])) return null;
    const coefficient = m[2] === "" ? frac(1) : parseFraction(m[2]);
    if (!coefficient) return null;
    const degree = m[3] ? (m[4] ? Number(m[4]) : 1) : 0;
    if (degree > 12) return null;
    parsed.push([degree, m[1] === "-" ? neg(coefficient) : coefficient]);
  }
  return poly(parsed);
}
