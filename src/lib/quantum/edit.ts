import { GATE_ARITY, MAX_QUBITS, ROTATIONS, validateCircuit, type Circuit, type Op } from "./types";

// Editing a circuit the way the drawing board does: click a cell to place a
// gate, click it again to take it off. Pure, so the rules are testable.

export const MIN_COLUMNS = 10;

// The gate that sits on this wire in this column, if any.
export function opAt(circuit: Circuit, column: number, qubit: number): Op | undefined {
  return circuit.ops.find((o) => o.column === column && o.qubits.includes(qubit));
}

export function removeOp(circuit: Circuit, column: number, qubit: number): Circuit {
  const op = opAt(circuit, column, qubit);
  return op ? { ...circuit, ops: circuit.ops.filter((o) => o !== op) } : circuit;
}

const sameGate = (a: Op, b: Op) =>
  a.gate === b.gate && a.qubits.length === 1 && b.qubits.length === 1 && a.qubits[0] === b.qubits[0] && (a.angle ?? 0) === (b.angle ?? 0);

// Places a gate. On a single-qubit gate, whatever is on that wire is replaced,
// and placing the same gate again takes it off. A gate on several wires needs
// them all free in its column.
export function placeOp(circuit: Circuit, op: Op): { circuit: Circuit } | { error: string } {
  if (op.qubits.length !== GATE_ARITY[op.gate]) return { error: `${op.gate} acts on ${GATE_ARITY[op.gate]} qubits.` };
  if (op.qubits.some((q) => q < 0 || q >= circuit.qubits)) return { error: "That wire isn't in the circuit." };
  if (new Set(op.qubits).size !== op.qubits.length) return { error: `${op.gate} needs different wires.` };
  const clean = { ...op, ...(ROTATIONS.has(op.gate) ? {} : { angle: undefined }) };
  if (clean.angle === undefined) delete clean.angle;
  if (op.qubits.length === 1) {
    const existing = opAt(circuit, op.column, op.qubits[0]);
    if (existing && sameGate(existing, clean)) return { circuit: removeOp(circuit, op.column, op.qubits[0]) };
    const without = existing ? removeOp(circuit, op.column, op.qubits[0]) : circuit;
    return { circuit: { ...without, ops: [...without.ops, clean] } };
  }
  if (op.qubits.some((q) => opAt(circuit, op.column, q))) return { error: "That column is already using one of those wires." };
  return { circuit: { ...circuit, ops: [...circuit.ops, clean] } };
}

// A different number of wires; gates that touched a removed wire go with it.
export function resizeQubits(circuit: Circuit, qubits: number): Circuit {
  const n = Math.min(MAX_QUBITS, Math.max(1, Math.round(qubits)));
  return { qubits: n, ops: circuit.ops.filter((o) => o.qubits.every((q) => q < n)) };
}

// How many columns to draw: always room for one more step.
export function visibleColumns(circuit: Circuit): number {
  const last = circuit.ops.reduce((max, o) => Math.max(max, o.column), -1);
  return Math.max(MIN_COLUMNS, last + 2);
}

// A circuit read back from storage; anything unusable is an empty one.
export function parseStoredCircuit(raw: unknown, fallbackQubits = 2): Circuit {
  const empty: Circuit = { qubits: fallbackQubits, ops: [] };
  if (!raw || typeof raw !== "object") return empty;
  const { qubits, ops } = raw as { qubits?: unknown; ops?: unknown };
  if (!Number.isInteger(qubits) || !Array.isArray(ops)) return empty;
  const candidate: Circuit = {
    qubits: qubits as number,
    ops: ops.filter((o): o is Op => !!o && typeof o === "object" && typeof (o as Op).gate === "string" && Array.isArray((o as Op).qubits)),
  };
  return validateCircuit(candidate) === null ? candidate : empty;
}
