import { fidelity, run, unitaryOverlap, type State } from "./simulate";
import { validateCircuit, type Circuit, type GateName, type Op } from "./types";

// Build-it challenges, checked by the simulator: make a circuit that prepares
// a state, or that does the same thing as another gate built from a limited
// set. Each target is written out independently of its reference solution
// (kept for "show a solution"), so a passing solution is real evidence.

export type Check = { kind: "state"; target: State } | { kind: "unitary"; target: Circuit };

export interface Challenge {
  id: string;
  title: string;
  // What to build; LaTeX between $…$ renders in MathText.
  goal: string;
  hint: string;
  qubits: number;
  allowed: GateName[];
  check: Check;
  solution: Op[];
}

const ALL_SINGLE: GateName[] = ["H", "X", "Y", "Z", "S", "Sdg", "T", "Tdg", "Rx", "Ry", "Rz"];
const ALL: GateName[] = [...ALL_SINGLE, "CNOT", "CZ", "SWAP", "CCX"];

// A state written out: [basis index, real, imaginary] for every nonzero
// amplitude, normalised.
function stateOf(n: number, amplitudes: [number, number, number][]): State {
  const norm = Math.sqrt(amplitudes.reduce((sum, [, re, im]) => sum + re * re + im * im, 0));
  const state: State = { n, re: new Float64Array(1 << n), im: new Float64Array(1 << n) };
  for (const [index, re, im] of amplitudes) {
    state.re[index] = re / norm;
    state.im[index] = im / norm;
  }
  return state;
}

const op = (gate: GateName, column: number, qubits: number[], angle?: number): Op => ({ gate, column, qubits, ...(angle === undefined ? {} : { angle }) });

export const CHALLENGES: Challenge[] = [
  {
    id: "flip",
    title: "Flip it",
    goal: "Prepare $|1\\rangle$ from $|0\\rangle$.",
    hint: "One gate that swaps $|0\\rangle$ and $|1\\rangle$.",
    qubits: 1,
    allowed: ALL_SINGLE,
    check: { kind: "state", target: stateOf(1, [[1, 1, 0]]) },
    solution: [op("X", 0, [0])],
  },
  {
    id: "plus",
    title: "Superposition",
    goal: "Prepare $|+\\rangle = \\tfrac{1}{\\sqrt{2}}(|0\\rangle + |1\\rangle)$.",
    hint: "The gate that turns a definite state into an equal mix.",
    qubits: 1,
    allowed: ALL_SINGLE,
    check: { kind: "state", target: stateOf(1, [[0, 1, 0], [1, 1, 0]]) },
    solution: [op("H", 0, [0])],
  },
  {
    id: "minus",
    title: "The other superposition",
    goal: "Prepare $|-\\rangle = \\tfrac{1}{\\sqrt{2}}(|0\\rangle - |1\\rangle)$.",
    hint: "Same weights as $|+\\rangle$, opposite relative sign. Try flipping first.",
    qubits: 1,
    allowed: ALL_SINGLE,
    check: { kind: "state", target: stateOf(1, [[0, 1, 0], [1, -1, 0]]) },
    solution: [op("X", 0, [0]), op("H", 1, [0])],
  },
  {
    id: "plus-i",
    title: "Around the equator",
    goal: "Prepare $|{+i}\\rangle = \\tfrac{1}{\\sqrt{2}}(|0\\rangle + i|1\\rangle)$.",
    hint: "Make $|+\\rangle$, then turn it a quarter of the way round the equator: the $S$ gate.",
    qubits: 1,
    allowed: ALL_SINGLE,
    check: { kind: "state", target: stateOf(1, [[0, 1, 0], [1, 0, 1]]) },
    solution: [op("H", 0, [0]), op("S", 1, [0])],
  },
  {
    id: "tilt",
    title: "Tilt it",
    goal: "Prepare $\\cos(\\pi/8)|0\\rangle + \\sin(\\pi/8)|1\\rangle$, a state an eighth of a turn from $|0\\rangle$.",
    hint: "A rotation about $y$ moves a state in the plane of $|0\\rangle$, $|+\\rangle$, $|1\\rangle$, $|-\\rangle$. The angle is twice the one in the state.",
    qubits: 1,
    allowed: ALL_SINGLE,
    check: { kind: "state", target: stateOf(1, [[0, Math.cos(Math.PI / 8), 0], [1, Math.sin(Math.PI / 8), 0]]) },
    solution: [op("Ry", 0, [0], Math.PI / 4)],
  },
  {
    id: "bell",
    title: "Entangle two qubits",
    goal: "Prepare the Bell state $\\tfrac{1}{\\sqrt{2}}(|00\\rangle + |11\\rangle)$.",
    hint: "Put the first qubit in superposition, then use it to control a flip on the second.",
    qubits: 2,
    allowed: ALL,
    check: { kind: "state", target: stateOf(2, [[0, 1, 0], [3, 1, 0]]) },
    solution: [op("H", 0, [0]), op("CNOT", 1, [0, 1])],
  },
  {
    id: "singlet",
    title: "The singlet",
    goal: "Prepare $\\tfrac{1}{\\sqrt{2}}(|01\\rangle - |10\\rangle)$.",
    hint: "Start from $|01\\rangle$, make a Bell-type pair, then fix the sign with a phase flip.",
    qubits: 2,
    allowed: ALL,
    check: { kind: "state", target: stateOf(2, [[1, 1, 0], [2, -1, 0]]) },
    solution: [op("X", 0, [1]), op("H", 0, [0]), op("CNOT", 1, [0, 1]), op("Z", 2, [0])],
  },
  {
    id: "ghz",
    title: "Three together",
    goal: "Prepare the GHZ state $\\tfrac{1}{\\sqrt{2}}(|000\\rangle + |111\\rangle)$.",
    hint: "Extend the Bell-state circuit: each new qubit copies the flip from the one before.",
    qubits: 3,
    allowed: ALL,
    check: { kind: "state", target: stateOf(3, [[0, 1, 0], [7, 1, 0]]) },
    solution: [op("H", 0, [0]), op("CNOT", 1, [0, 1]), op("CNOT", 2, [1, 2])],
  },
  {
    id: "uniform",
    title: "Every outcome equally likely",
    goal: "Prepare an equal superposition of all eight 3-qubit basis states, $\\tfrac{1}{\\sqrt{8}}\\sum_x |x\\rangle$.",
    hint: "Each qubit on its own.",
    qubits: 3,
    allowed: ALL,
    check: { kind: "state", target: stateOf(3, Array.from({ length: 8 }, (_, i): [number, number, number] => [i, 1, 0])) },
    solution: [op("H", 0, [0]), op("H", 0, [1]), op("H", 0, [2])],
  },
  {
    id: "swap",
    title: "Swap without SWAP",
    goal: "Build a SWAP of two qubits using only CNOT gates.",
    hint: "Three CNOTs, alternating which qubit controls.",
    qubits: 2,
    allowed: ["CNOT", "X"],
    check: { kind: "unitary", target: { qubits: 2, ops: [op("SWAP", 0, [0, 1])] } },
    solution: [op("CNOT", 0, [0, 1]), op("CNOT", 1, [1, 0]), op("CNOT", 2, [0, 1])],
  },
  {
    id: "cz",
    title: "CZ from CNOT",
    goal: "Build a controlled-$Z$ using only $H$ and CNOT.",
    hint: "$HZH = X$: surround a CNOT's target with Hadamards.",
    qubits: 2,
    allowed: ["H", "CNOT"],
    check: { kind: "unitary", target: { qubits: 2, ops: [op("CZ", 0, [0, 1])] } },
    solution: [op("H", 0, [1]), op("CNOT", 1, [0, 1]), op("H", 2, [1])],
  },
  {
    id: "reverse",
    title: "Turn a CNOT around",
    goal: "Build a CNOT whose control is the second qubit and target the first, using only $H$ and a CNOT with the first qubit as control.",
    hint: "Hadamards on both qubits swap the roles of control and target.",
    qubits: 2,
    allowed: ["H", "CNOT"],
    check: { kind: "unitary", target: { qubits: 2, ops: [op("CNOT", 0, [1, 0])] } },
    solution: [op("H", 0, [0]), op("H", 0, [1]), op("CNOT", 1, [0, 1]), op("H", 2, [0]), op("H", 2, [1])],
  },
];

export interface ChallengeResult {
  solved: boolean;
  // Why not, for the learner.
  reason: string | null;
}

// Whether a circuit solves a challenge: the right number of qubits, only the
// allowed gates, and the right state or the right operation (any global phase).
export function checkChallenge(challenge: Challenge, circuit: Circuit): ChallengeResult {
  const problem = validateCircuit(circuit);
  if (problem) return { solved: false, reason: problem };
  if (circuit.qubits !== challenge.qubits) {
    return { solved: false, reason: `This one uses ${challenge.qubits} qubit${challenge.qubits === 1 ? "" : "s"}.` };
  }
  const banned = circuit.ops.find((o) => !challenge.allowed.includes(o.gate));
  if (banned) return { solved: false, reason: `The ${banned.gate} gate isn't allowed here.` };
  if (circuit.ops.length === 0) return { solved: false, reason: null };
  const { check } = challenge;
  if (check.kind === "state") {
    return { solved: fidelity(run(circuit), check.target) > 1 - 1e-9, reason: null };
  }
  return { solved: unitaryOverlap(circuit, check.target) > 1 - 1e-9, reason: null };
}

export function challengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}
