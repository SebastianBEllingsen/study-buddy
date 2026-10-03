// A quantum circuit as a student draws it: wires down the page, time running
// left to right in columns. Pure and client-safe (lib/quantum/).

export type GateName = "H" | "X" | "Y" | "Z" | "S" | "Sdg" | "T" | "Tdg" | "Rx" | "Ry" | "Rz" | "CNOT" | "CZ" | "SWAP" | "CCX";

export const GATE_ARITY: Record<GateName, number> = {
  H: 1, X: 1, Y: 1, Z: 1, S: 1, Sdg: 1, T: 1, Tdg: 1, Rx: 1, Ry: 1, Rz: 1, CNOT: 2, CZ: 2, SWAP: 2, CCX: 3,
};

// Rotations carry an angle, in radians.
export const ROTATIONS: ReadonlySet<GateName> = new Set<GateName>(["Rx", "Ry", "Rz"]);

export const MAX_QUBITS = 6;

// `qubits` are wire numbers, 0 at the top: a single-qubit gate has one, CNOT
// [control, target], CZ and SWAP [a, b], CCX (Toffoli) [control, control,
// target]. Two gates in one column never share a wire.
export interface Op {
  gate: GateName;
  column: number;
  qubits: number[];
  angle?: number;
}

export interface Circuit {
  qubits: number;
  ops: Op[];
}

// The reason a circuit can't run, or null if it can.
export function validateCircuit(circuit: Circuit): string | null {
  if (!Number.isInteger(circuit.qubits) || circuit.qubits < 1 || circuit.qubits > MAX_QUBITS) {
    return `A circuit has 1 to ${MAX_QUBITS} qubits.`;
  }
  const used = new Set<string>();
  for (const op of circuit.ops) {
    if (!(op.gate in GATE_ARITY)) return `Unknown gate ${String(op.gate)}.`;
    if (!Number.isInteger(op.column) || op.column < 0) return "A gate is in a column that doesn't exist.";
    if (op.qubits.length !== GATE_ARITY[op.gate]) return `${op.gate} acts on ${GATE_ARITY[op.gate]} qubit${GATE_ARITY[op.gate] === 1 ? "" : "s"}.`;
    if (new Set(op.qubits).size !== op.qubits.length) return `${op.gate} needs different qubits.`;
    if (ROTATIONS.has(op.gate) && !Number.isFinite(op.angle)) return `${op.gate} needs an angle.`;
    for (const q of op.qubits) {
      if (!Number.isInteger(q) || q < 0 || q >= circuit.qubits) return `${op.gate} uses a qubit that isn't in the circuit.`;
      const key = `${op.column}:${q}`;
      if (used.has(key)) return "Two gates are on the same wire in one column.";
      used.add(key);
    }
  }
  return null;
}
