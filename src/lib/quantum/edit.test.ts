import { describe, expect, it } from "vitest";
import { opAt, parseStoredCircuit, placeOp, removeOp, resizeQubits, visibleColumns } from "./edit";
import type { Circuit, Op } from "./types";

const c = (qubits: number, ...ops: Op[]): Circuit => ({ qubits, ops });
const h = (column: number, q: number): Op => ({ gate: "H", column, qubits: [q] });
const ok = (r: ReturnType<typeof placeOp>) => ("circuit" in r ? r.circuit : (() => { throw new Error(r.error); })());

describe("placeOp", () => {
  it("adds a gate, replaces what's on the wire, and takes off the same gate placed twice", () => {
    let circuit = ok(placeOp(c(2), h(0, 0)));
    expect(circuit.ops).toHaveLength(1);
    circuit = ok(placeOp(circuit, { gate: "X", column: 0, qubits: [0] }));
    expect(circuit.ops.map((o) => o.gate)).toEqual(["X"]);
    circuit = ok(placeOp(circuit, { gate: "X", column: 0, qubits: [0] }));
    expect(circuit.ops).toEqual([]);
  });

  it("treats a rotation with a different angle as a different gate", () => {
    const a = ok(placeOp(c(1), { gate: "Rz", column: 0, qubits: [0], angle: 1 }));
    const b = ok(placeOp(a, { gate: "Rz", column: 0, qubits: [0], angle: 2 }));
    expect(b.ops).toHaveLength(1);
    expect(b.ops[0].angle).toBe(2);
    expect(ok(placeOp(b, { gate: "Rz", column: 0, qubits: [0], angle: 2 })).ops).toEqual([]);
  });

  it("keeps a stray angle off gates that don't have one", () => {
    const circuit = ok(placeOp(c(1), { gate: "H", column: 0, qubits: [0], angle: 3 }));
    expect(circuit.ops[0]).toEqual({ gate: "H", column: 0, qubits: [0] });
  });

  it("places a multi-qubit gate only on free wires, and refuses otherwise", () => {
    const circuit = ok(placeOp(c(3), h(1, 1)));
    expect(placeOp(circuit, { gate: "CNOT", column: 1, qubits: [0, 1] })).toEqual({ error: "That column is already using one of those wires." });
    const placed = ok(placeOp(circuit, { gate: "CNOT", column: 2, qubits: [0, 1] }));
    expect(placed.ops).toHaveLength(2);
    // A gate can sit on a wire a CNOT's line merely crosses.
    expect(ok(placeOp(placed, h(2, 2))).ops).toHaveLength(3);
  });

  it("refuses the impossible", () => {
    expect(placeOp(c(2), { gate: "CNOT", column: 0, qubits: [0] })).toHaveProperty("error");
    expect(placeOp(c(2), { gate: "CNOT", column: 0, qubits: [0, 0] })).toHaveProperty("error");
    expect(placeOp(c(2), h(0, 5))).toHaveProperty("error");
    expect(placeOp(c(2), h(0, -1))).toHaveProperty("error");
  });

  it("puts a single-qubit gate over a multi-qubit one by removing that whole gate", () => {
    const cnot = ok(placeOp(c(2), { gate: "CNOT", column: 0, qubits: [0, 1] }));
    const replaced = ok(placeOp(cnot, h(0, 1)));
    expect(replaced.ops.map((o) => o.gate)).toEqual(["H"]);
  });
});

describe("opAt and removeOp", () => {
  it("find a gate from any wire it touches, and remove all of it", () => {
    const circuit = c(3, { gate: "CCX", column: 4, qubits: [0, 2, 1] });
    for (const q of [0, 1, 2]) expect(opAt(circuit, 4, q)?.gate).toBe("CCX");
    expect(opAt(circuit, 3, 0)).toBeUndefined();
    expect(removeOp(circuit, 4, 2).ops).toEqual([]);
    expect(removeOp(circuit, 0, 0)).toBe(circuit);
  });
});

describe("resizeQubits", () => {
  it("drops gates that touch a removed wire and keeps the rest", () => {
    const circuit = c(3, h(0, 0), { gate: "CNOT", column: 1, qubits: [0, 2] }, { gate: "CNOT", column: 2, qubits: [0, 1] });
    const smaller = resizeQubits(circuit, 2);
    expect(smaller.qubits).toBe(2);
    expect(smaller.ops.map((o) => o.gate)).toEqual(["H", "CNOT"]);
    expect(resizeQubits(circuit, 99).qubits).toBe(6);
    expect(resizeQubits(circuit, 0).qubits).toBe(1);
  });
});

describe("visibleColumns", () => {
  it("shows at least ten, and always one empty step more than the last gate", () => {
    expect(visibleColumns(c(1))).toBe(10);
    expect(visibleColumns(c(1, h(3, 0)))).toBe(10);
    expect(visibleColumns(c(1, h(9, 0)))).toBe(11);
  });
});

describe("parseStoredCircuit", () => {
  it("reads back a saved circuit, and anything damaged as an empty one", () => {
    const saved = c(2, h(0, 0), { gate: "CNOT", column: 1, qubits: [0, 1] });
    expect(parseStoredCircuit(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    for (const bad of [null, "x", 5, {}, { qubits: "2", ops: [] }, { qubits: 2, ops: "no" }, { qubits: 9, ops: [] }, { qubits: 1, ops: [h(0, 4)] }]) {
      expect(parseStoredCircuit(bad)).toEqual({ qubits: 2, ops: [] });
    }
  });
});
