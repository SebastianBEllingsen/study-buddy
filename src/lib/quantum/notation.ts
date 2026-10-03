import type { State } from "./simulate";
import { bitstring } from "./simulate";

// Writing states and gate angles the way a textbook does, as LaTeX for
// MathText (components/MathText.tsx).

const EPS = 1e-9;

function trimNumber(x: number, digits = 3): string {
  const s = x.toFixed(digits).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

// A complex number in decimals, for amplitudes with no tidy closed form.
function decimalComplex(re: number, im: number): string {
  if (Math.abs(im) < EPS) return trimNumber(re);
  if (Math.abs(re) < EPS) return `${trimNumber(im)}i`;
  return `(${trimNumber(re)} ${im < 0 ? "-" : "+"} ${trimNumber(Math.abs(im))}i)`;
}

// The phase as a sign and a factor, when it's a multiple of π/4 — the phases
// the standard gates make.
function phaseParts(re: number, im: number): { negative: boolean; factor: string } | null {
  const angle = Math.atan2(im, re);
  const eighths = Math.round(angle / (Math.PI / 4));
  if (Math.abs(angle - (eighths * Math.PI) / 4) > 1e-6) return null;
  switch (((eighths % 8) + 8) % 8) {
    case 0: return { negative: false, factor: "" };
    case 1: return { negative: false, factor: "e^{i\\pi/4}" };
    case 2: return { negative: false, factor: "i" };
    case 3: return { negative: false, factor: "e^{3i\\pi/4}" };
    case 4: return { negative: true, factor: "" };
    case 5: return { negative: false, factor: "e^{-3i\\pi/4}" };
    case 6: return { negative: true, factor: "i" };
    default: return { negative: false, factor: "e^{-i\\pi/4}" };
  }
}

function ket(n: number, index: number): string {
  return `|${bitstring(n, index)}\\rangle`;
}

// The state as a sum of kets. When every basis state present has the same
// weight, that's factored out — \frac{1}{\sqrt{2}}(|00⟩ + |11⟩) — and the
// terms show only their phases. Otherwise each amplitude is written out.
export function diracLatex(state: State): string {
  const terms: { index: number; re: number; im: number }[] = [];
  for (let i = 0; i < state.re.length; i++) {
    if (Math.hypot(state.re[i], state.im[i]) > EPS) terms.push({ index: i, re: state.re[i], im: state.im[i] });
  }
  if (terms.length === 0) return "0";
  const magnitudes = terms.map((t) => Math.hypot(t.re, t.im));
  const equalWeight = magnitudes.every((m) => Math.abs(m - magnitudes[0]) < 1e-7);
  const phases = terms.map((t) => phaseParts(t.re, t.im));

  if (equalWeight && phases.every(Boolean)) {
    const k = terms.length;
    const root = Math.sqrt(k);
    const coefficient = k === 1 ? "" : Number.isInteger(root) ? `\\frac{1}{${root}}` : `\\frac{1}{\\sqrt{${k}}}`;
    let sum = "";
    terms.forEach((t, i) => {
      const { negative, factor } = phases[i] as { negative: boolean; factor: string };
      const body = `${factor}${ket(state.n, t.index)}`;
      sum += i === 0 ? `${negative ? "-" : ""}${body}` : ` ${negative ? "-" : "+"} ${body}`;
    });
    if (k === 1) return sum;
    return `${coefficient}\\left(${sum}\\right)`;
  }

  return terms
    .map((t, i) => {
      const exactlyOne = Math.abs(t.im) < EPS && Math.abs(Math.abs(t.re) - 1) < EPS;
      const amplitude = exactlyOne ? (t.re < 0 ? "-" : "") : decimalComplex(t.re, t.im);
      const negative = amplitude.startsWith("-");
      const body = `${negative ? amplitude.slice(1) : amplitude}${ket(state.n, t.index)}`;
      if (i === 0) return negative ? `-${body}` : body;
      return ` ${negative ? "-" : "+"} ${body}`;
    })
    .join("");
}

// A rotation angle: multiples of π/4 as fractions of π, anything else in radians.
export function formatAngle(radians: number): string {
  const quarters = radians / (Math.PI / 4);
  if (Math.abs(quarters - Math.round(quarters)) < 1e-9) {
    const q = Math.round(quarters);
    if (q === 0) return "0";
    const sign = q < 0 ? "-" : "";
    const a = Math.abs(q);
    if (a % 4 === 0) return `${sign}${a / 4 === 1 ? "" : a / 4}π`;
    if (a % 2 === 0) return `${sign}${a / 2 === 1 ? "" : a / 2}π/2`;
    return `${sign}${a === 1 ? "" : a}π/4`;
  }
  return `${trimNumber(radians, 2)} rad`;
}

// A phase in (-π, π] for display next to an amplitude.
export function phaseOf(re: number, im: number): number {
  return Math.hypot(re, im) < EPS ? 0 : Math.atan2(im, re);
}
