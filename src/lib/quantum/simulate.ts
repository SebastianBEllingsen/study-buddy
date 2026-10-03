import { validateCircuit, type Circuit, type GateName, type Op } from "./types";

// A statevector simulator, exact up to floating point. The state of n qubits
// is 2^n complex amplitudes. Qubit 0 is the leftmost in a ket and the top wire
// of the circuit: in |q0 q1 q2⟩ the index is q0·4 + q1·2 + q2, the order of
// Nielsen & Chuang (not Qiskit's, which counts the other way).

export interface State {
  n: number;
  re: Float64Array;
  im: Float64Array;
}

export function basisState(n: number, index = 0): State {
  const size = 1 << n;
  const state = { n, re: new Float64Array(size), im: new Float64Array(size) };
  state.re[index] = 1;
  return state;
}

export function cloneState(s: State): State {
  return { n: s.n, re: Float64Array.from(s.re), im: Float64Array.from(s.im) };
}

// The bit of a basis index that belongs to qubit q.
function mask(n: number, q: number): number {
  return 1 << (n - 1 - q);
}

// A 2×2 complex matrix: g[row][col] = [re, im].
type Complex = [number, number];
type Gate2 = [[Complex, Complex], [Complex, Complex]];

const R = Math.SQRT1_2;
const H: Gate2 = [[[R, 0], [R, 0]], [[R, 0], [-R, 0]]];
const X: Gate2 = [[[0, 0], [1, 0]], [[1, 0], [0, 0]]];
const Y: Gate2 = [[[0, 0], [0, -1]], [[0, 1], [0, 0]]];
const Z: Gate2 = [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]];
const phase = (angle: number): Gate2 => [[[1, 0], [0, 0]], [[0, 0], [Math.cos(angle), Math.sin(angle)]]];

function single(gate: GateName, angle = 0): Gate2 {
  const c = Math.cos(angle / 2);
  const s = Math.sin(angle / 2);
  switch (gate) {
    case "H": return H;
    case "X": return X;
    case "Y": return Y;
    case "Z": return Z;
    case "S": return phase(Math.PI / 2);
    case "Sdg": return phase(-Math.PI / 2);
    case "T": return phase(Math.PI / 4);
    case "Tdg": return phase(-Math.PI / 4);
    case "Rx": return [[[c, 0], [0, -s]], [[0, -s], [c, 0]]];
    case "Ry": return [[[c, 0], [-s, 0]], [[s, 0], [c, 0]]];
    case "Rz": return [[[c, -s], [0, 0]], [[0, 0], [c, s]]];
    default: throw new Error(`${gate} isn't a single-qubit gate`);
  }
}

// Applies `g` to the target wherever every control bit is 1.
function applyControlled(state: State, target: number, controlsMask: number, g: Gate2): void {
  const { n, re, im } = state;
  const t = mask(n, target);
  for (let i = 0; i < 1 << n; i++) {
    if (i & t || (i & controlsMask) !== controlsMask) continue;
    const j = i | t;
    const ar = re[i], ai = im[i], br = re[j], bi = im[j];
    re[i] = g[0][0][0] * ar - g[0][0][1] * ai + g[0][1][0] * br - g[0][1][1] * bi;
    im[i] = g[0][0][0] * ai + g[0][0][1] * ar + g[0][1][0] * bi + g[0][1][1] * br;
    re[j] = g[1][0][0] * ar - g[1][0][1] * ai + g[1][1][0] * br - g[1][1][1] * bi;
    im[j] = g[1][0][0] * ai + g[1][0][1] * ar + g[1][1][0] * bi + g[1][1][1] * br;
  }
}

function applySwap(state: State, a: number, b: number): void {
  const { n, re, im } = state;
  const ma = mask(n, a), mb = mask(n, b);
  for (let i = 0; i < 1 << n; i++) {
    // Swap the pairs where the two bits differ, once each.
    if (!(i & ma) || i & mb) continue;
    const j = (i ^ ma) | mb;
    [re[i], re[j]] = [re[j], re[i]];
    [im[i], im[j]] = [im[j], im[i]];
  }
}

function applyOp(state: State, op: Op): void {
  const n = state.n;
  const [a, b, c] = op.qubits;
  switch (op.gate) {
    case "CNOT": return applyControlled(state, b, mask(n, a), X);
    case "CZ": return applyControlled(state, b, mask(n, a), Z);
    case "CCX": return applyControlled(state, c, mask(n, a) | mask(n, b), X);
    case "SWAP": return applySwap(state, a, b);
    default: return applyControlled(state, a, 0, single(op.gate, op.angle));
  }
}

// Runs the circuit on |0…0⟩, or on `initial`. Gates apply column by column.
export function run(circuit: Circuit, initial?: State): State {
  const problem = validateCircuit(circuit);
  if (problem) throw new Error(problem);
  const state = initial ? cloneState(initial) : basisState(circuit.qubits);
  if (state.n !== circuit.qubits) throw new Error("The starting state has a different number of qubits.");
  const ordered = circuit.ops.map((op, i) => ({ op, i })).sort((x, y) => x.op.column - y.op.column || x.i - y.i);
  for (const { op } of ordered) applyOp(state, op);
  return state;
}

export function probabilities(state: State): number[] {
  return Array.from(state.re, (r, i) => r * r + state.im[i] * state.im[i]);
}

// ---- Comparing ----------------------------------------------------------

// |⟨a|b⟩|²: 1 for the same state, whatever the global phase.
export function fidelity(a: State, b: State): number {
  let re = 0, im = 0;
  for (let i = 0; i < a.re.length; i++) {
    re += a.re[i] * b.re[i] + a.im[i] * b.im[i];
    im += a.re[i] * b.im[i] - a.im[i] * b.re[i];
  }
  return re * re + im * im;
}

// The circuit's unitary: column j is what it does to basis state |j⟩.
export function unitary(circuit: Circuit): { re: Float64Array; im: Float64Array; dim: number } {
  const dim = 1 << circuit.qubits;
  const re = new Float64Array(dim * dim), im = new Float64Array(dim * dim);
  for (let j = 0; j < dim; j++) {
    const out = run(circuit, basisState(circuit.qubits, j));
    for (let i = 0; i < dim; i++) {
      re[i * dim + j] = out.re[i];
      im[i * dim + j] = out.im[i];
    }
  }
  return { re, im, dim };
}

// |tr(U†V)| / dim: 1 when the two circuits do the same thing up to a global
// phase, which no measurement can see.
export function unitaryOverlap(a: Circuit, b: Circuit): number {
  if (a.qubits !== b.qubits) return 0;
  const u = unitary(a), v = unitary(b);
  let re = 0, im = 0;
  for (let k = 0; k < u.re.length; k++) {
    re += u.re[k] * v.re[k] + u.im[k] * v.im[k];
    im += u.re[k] * v.im[k] - u.im[k] * v.re[k];
  }
  return Math.hypot(re, im) / u.dim;
}

// ---- Measuring -----------------------------------------------------------

// A small seeded generator, so a run of "1024 shots" is repeatable.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bitstring(n: number, index: number): string {
  return index.toString(2).padStart(n, "0");
}

// Measures every qubit `shots` times. Returns the counts by outcome.
export function sample(state: State, shots: number, random: () => number = Math.random): Map<string, number> {
  const p = probabilities(state);
  const cumulative: number[] = [];
  p.reduce((sum, x, i) => (cumulative[i] = sum + x), 0);
  const counts = new Map<string, number>();
  for (let s = 0; s < shots; s++) {
    const r = random() * cumulative[cumulative.length - 1];
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > r) hi = mid;
      else lo = mid + 1;
    }
    const key = bitstring(state.n, lo);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// One qubit on its own: the point on the Bloch sphere it sits at, with the
// other qubits traced out. A qubit entangled with the rest is inside the
// sphere (length < 1); at the very centre it's maximally entangled.
export function blochVector(state: State, qubit: number): { x: number; y: number; z: number } {
  const m = mask(state.n, qubit);
  let p0 = 0, p1 = 0, rho01Re = 0, rho01Im = 0;
  for (let i = 0; i < 1 << state.n; i++) {
    if (i & m) continue;
    const j = i | m;
    p0 += state.re[i] ** 2 + state.im[i] ** 2;
    p1 += state.re[j] ** 2 + state.im[j] ** 2;
    // ρ01 = Σ ψ(…0…) · conj(ψ(…1…))
    rho01Re += state.re[i] * state.re[j] + state.im[i] * state.im[j];
    rho01Im += state.im[i] * state.re[j] - state.re[i] * state.im[j];
  }
  return { x: 2 * rho01Re, y: -2 * rho01Im, z: p0 - p1 };
}
