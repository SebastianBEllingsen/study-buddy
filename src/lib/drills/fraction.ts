// Exact rational arithmetic for drills: every answer is a fraction, so a
// correct answer is exactly equal, never "close enough". Numbers are small
// (a few digits), so plain integers are plenty.

export interface Fraction {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export function frac(n: number, d = 1): Fraction {
  if (d === 0) throw new Error("A fraction can't have a zero denominator.");
  const g = gcd(n, d) || 1;
  const sign = d < 0 ? -1 : 1;
  return { n: (sign * n) / g || 0, d: Math.abs(d) / g };
}

export const ZERO = frac(0);
export const ONE = frac(1);

export const add = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.n, a.d * b.d);
export const div = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d, a.d * b.n);
export const neg = (a: Fraction): Fraction => frac(-a.n, a.d);
export const eq = (a: Fraction, b: Fraction): boolean => a.n === b.n && a.d === b.d;
export const isZero = (a: Fraction): boolean => a.n === 0;
export const toNumber = (a: Fraction): number => a.n / a.d;
export const pow = (a: Fraction, k: number): Fraction => (k <= 0 ? ONE : mul(a, pow(a, k - 1)));

export function fracToString(a: Fraction): string {
  return a.d === 1 ? String(a.n) : `${a.n}/${a.d}`;
}

// As LaTeX: 3/4 → \frac{3}{4}, -3/4 → -\frac{3}{4}, 2 → 2.
export function fracToLatex(a: Fraction): string {
  if (a.d === 1) return String(a.n);
  return `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`;
}

const MAX_DECIMALS = 9;

// Reads "3/4", "-3/4", "2", "0.75", ".5", "−1/2" (with a real minus sign) and
// spaces around the slash. Anything else is null. A decimal is read exactly
// (0.75 is 3/4); 0.333 is 333/1000, not 1/3.
export function parseFraction(text: string): Fraction | null {
  // "1 2" is two numbers, not twelve.
  if (/\d\s+\d/.test(text)) return null;
  const t = text.replace(/−/g, "-").replace(/\s+/g, "");
  let m = /^([+-]?)(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[3]) === 0 ? null : frac(Number(m[1] + m[2]), Number(m[3]));
  m = /^([+-]?)(\d*)\.?(\d*)$/.exec(t);
  if (!m || (m[2] === "" && m[3] === "") || m[3].length > MAX_DECIMALS) return null;
  if (!t.includes(".") && m[2] === "") return null;
  const whole = Number(`${m[1]}${m[2] || "0"}`) ;
  if (m[3] === "") return frac(whole);
  const scale = 10 ** m[3].length;
  const digits = Number(m[3]);
  return frac(m[1] === "-" ? whole * scale - digits : whole * scale + digits, scale);
}

// A Gaussian rational: re + im·i, both exact.
export interface Gaussian {
  re: Fraction;
  im: Fraction;
}

export const cx = (re: Fraction, im: Fraction = ZERO): Gaussian => ({ re, im });
export const cadd = (a: Gaussian, b: Gaussian): Gaussian => cx(add(a.re, b.re), add(a.im, b.im));
export const cmul = (a: Gaussian, b: Gaussian): Gaussian => cx(sub(mul(a.re, b.re), mul(a.im, b.im)), add(mul(a.re, b.im), mul(a.im, b.re)));
export const conj = (a: Gaussian): Gaussian => cx(a.re, neg(a.im));
export const ceq = (a: Gaussian, b: Gaussian): boolean => eq(a.re, b.re) && eq(a.im, b.im);
export const abs2 = (a: Gaussian): Fraction => add(mul(a.re, a.re), mul(a.im, a.im));

// 3 + 4i, -i, 2, 1/2 - 3/4i: the forms a student types. Null if unreadable.
export function parseGaussian(text: string): Gaussian | null {
  if (/\d\s+\d/.test(text)) return null;
  const t = text.replace(/−/g, "-").replace(/[\s*]/g, "");
  if (!t) return null;
  const terms = t.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join("") !== t) return null;
  let re = ZERO, im = ZERO;
  for (const term of terms) {
    if (term.endsWith("i")) {
      const body = term.slice(0, -1);
      const coefficient = body === "" || body === "+" ? ONE : body === "-" ? frac(-1) : parseFraction(body);
      if (!coefficient) return null;
      im = add(im, coefficient);
    } else {
      const value = parseFraction(term);
      if (!value) return null;
      re = add(re, value);
    }
  }
  return cx(re, im);
}

export function gaussianToLatex(a: Gaussian): string {
  if (isZero(a.im)) return fracToLatex(a.re);
  const imag = `${eq(a.im, ONE) ? "" : eq(a.im, frac(-1)) ? "-" : fracToLatex(a.im)}i`;
  if (isZero(a.re)) return imag;
  return `${fracToLatex(a.re)} ${imag.startsWith("-") ? "-" : "+"} ${imag.startsWith("-") ? imag.slice(1) : imag}`;
}
