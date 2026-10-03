import { describe, expect, it } from "vitest";
import {
  basisState, bitstring, blochVector, fidelity, mulberry32, probabilities, run, sample, unitaryOverlap,
  type State,
} from "./simulate";
import { validateCircuit, type Circuit, type GateName, type Op } from "./types";
import { diracLatex, formatAngle } from "./notation";
import { CHALLENGES, checkChallenge } from "./challenges";

const op = (gate: GateName, column: number, qubits: number[], angle?: number): Op => ({ gate, column, qubits, ...(angle === undefined ? {} : { angle }) });
const circuit = (qubits: number, ...ops: Op[]): Circuit => ({ qubits, ops });
const amp = (s: State, i: number): [number, number] => [s.re[i], s.im[i]];
const near = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);
const R = Math.SQRT1_2;

describe("single-qubit gates", () => {
  it("X flips, H splits evenly, Y and Z add their phases", () => {
    expect(amp(run(circuit(1, op("X", 0, [0]))), 1)).toEqual([1, 0]);
    const plus = run(circuit(1, op("H", 0, [0])));
    near(plus.re[0], R); near(plus.re[1], R);
    // Y|0⟩ = i|1⟩
    const y = run(circuit(1, op("Y", 0, [0])));
    near(y.re[1], 0); near(y.im[1], 1);
    // Z|1⟩ = -|1⟩
    near(run(circuit(1, op("X", 0, [0]), op("Z", 1, [0]))).re[1], -1);
  });

  it("H, X, Y and Z are their own inverses", () => {
    for (const g of ["H", "X", "Y", "Z"] as GateName[]) {
      near(unitaryOverlap(circuit(1, op(g, 0, [0]), op(g, 1, [0])), circuit(1, op("X", 0, [0]), op("X", 1, [0]))), 1);
    }
  });

  it("S² = Z, T² = S, and the daggers undo them", () => {
    near(unitaryOverlap(circuit(1, op("S", 0, [0]), op("S", 1, [0])), circuit(1, op("Z", 0, [0]))), 1);
    near(unitaryOverlap(circuit(1, op("T", 0, [0]), op("T", 1, [0])), circuit(1, op("S", 0, [0]))), 1);
    near(unitaryOverlap(circuit(1, op("S", 0, [0]), op("Sdg", 1, [0])), circuit(1, op("X", 0, [0]), op("X", 1, [0]))), 1);
    near(unitaryOverlap(circuit(1, op("T", 0, [0]), op("Tdg", 1, [0])), circuit(1, op("Z", 0, [0]), op("Z", 1, [0]))), 1);
  });

  it("satisfies the textbook identities HZH = X and HXH = Z", () => {
    near(unitaryOverlap(circuit(1, op("H", 0, [0]), op("Z", 1, [0]), op("H", 2, [0])), circuit(1, op("X", 0, [0]))), 1);
    near(unitaryOverlap(circuit(1, op("H", 0, [0]), op("X", 1, [0]), op("H", 2, [0])), circuit(1, op("Z", 0, [0]))), 1);
  });

  it("rotations: Rx(π) ∝ X, Ry(π)|0⟩ = |1⟩, Rz(π/2) ∝ S, and a full turn is a global phase", () => {
    near(unitaryOverlap(circuit(1, op("Rx", 0, [0], Math.PI)), circuit(1, op("X", 0, [0]))), 1);
    near(run(circuit(1, op("Ry", 0, [0], Math.PI))).re[1], 1);
    near(unitaryOverlap(circuit(1, op("Rz", 0, [0], Math.PI / 2)), circuit(1, op("S", 0, [0]))), 1);
    const full = run(circuit(1, op("Rx", 0, [0], 2 * Math.PI)));
    near(full.re[0], -1); // -I: the famous sign flip of a 2π spinor rotation
  });
});

describe("several qubits", () => {
  it("counts qubit 0 as the leftmost bit of the ket", () => {
    expect(amp(run(circuit(2, op("X", 0, [0]))), 2)).toEqual([1, 0]); // |10⟩
    expect(amp(run(circuit(2, op("X", 0, [1]))), 1)).toEqual([1, 0]); // |01⟩
    expect(amp(run(circuit(3, op("X", 0, [0]), op("X", 0, [2]))), 5)).toEqual([1, 0]); // |101⟩
  });

  it("CNOT flips the target only when the control is 1", () => {
    const table = [0, 1, 2, 3].map((i) => {
      const out = run(circuit(2, op("CNOT", 0, [0, 1])), basisState(2, i));
      return probabilities(out).indexOf(1);
    });
    expect(table).toEqual([0, 1, 3, 2]); // |10⟩ → |11⟩, |11⟩ → |10⟩
    // With the wires the other way round it's a different gate.
    const reversed = [0, 1, 2, 3].map((i) => probabilities(run(circuit(2, op("CNOT", 0, [1, 0])), basisState(2, i))).indexOf(1));
    expect(reversed).toEqual([0, 3, 2, 1]);
  });

  it("CZ only flips the sign of |11⟩, and is the same either way round", () => {
    const out = run(circuit(2, op("CZ", 0, [0, 1])), (() => { const s = basisState(2, 3); return s; })());
    expect(amp(out, 3)).toEqual([-1, 0]);
    near(unitaryOverlap(circuit(2, op("CZ", 0, [0, 1])), circuit(2, op("CZ", 0, [1, 0]))), 1);
  });

  it("SWAP exchanges the qubits", () => {
    const out = run(circuit(3, op("SWAP", 0, [0, 2])), basisState(3, 0b100));
    expect(probabilities(out).indexOf(1)).toBe(0b001);
    const same = run(circuit(2, op("SWAP", 0, [0, 1])), basisState(2, 0b11));
    expect(probabilities(same).indexOf(1)).toBe(0b11);
  });

  it("Toffoli flips the target only when both controls are 1", () => {
    const results = Array.from({ length: 8 }, (_, i) => probabilities(run(circuit(3, op("CCX", 0, [0, 1, 2])), basisState(3, i))).indexOf(1));
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 7, 6]);
  });

  it("makes the Bell state from H and CNOT", () => {
    const bell = run(circuit(2, op("H", 0, [0]), op("CNOT", 1, [0, 1])));
    near(bell.re[0], R); near(bell.re[3], R); near(bell.re[1], 0); near(bell.re[2], 0);
    expect(probabilities(bell).map((p) => +p.toFixed(6))).toEqual([0.5, 0, 0, 0.5]);
  });

  it("makes a GHZ state", () => {
    const ghz = run(circuit(3, op("H", 0, [0]), op("CNOT", 1, [0, 1]), op("CNOT", 2, [1, 2])));
    expect(probabilities(ghz).map((p) => +p.toFixed(6))).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0.5]);
  });

  it("applies gates column by column, in drawing order within a column", () => {
    // H then X on one wire differs from X then H — columns decide, not array order.
    const hThenX = run(circuit(1, op("X", 1, [0]), op("H", 0, [0])));
    const xThenH = run(circuit(1, op("H", 1, [0]), op("X", 0, [0])));
    expect(fidelity(hThenX, run(circuit(1, op("H", 0, [0]), op("X", 1, [0]))))).toBeCloseTo(1, 12);
    expect(fidelity(xThenH, run(circuit(1, op("X", 0, [0]), op("H", 1, [0]))))).toBeCloseTo(1, 12);
    expect(fidelity(hThenX, xThenH)).toBeLessThan(1 - 1e-6);
  });

  it("keeps the state normalised through any circuit, and is reversible", () => {
    const random = mulberry32(99);
    const gates: GateName[] = ["H", "X", "Y", "Z", "S", "Sdg", "T", "Tdg", "Rx", "Ry", "Rz", "CNOT", "CZ", "SWAP", "CCX"];
    for (let trial = 0; trial < 40; trial++) {
      const n = 3;
      const ops: Op[] = [];
      for (let c = 0; c < 12; c++) {
        const gate = gates[Math.floor(random() * gates.length)];
        const arity = { CNOT: 2, CZ: 2, SWAP: 2, CCX: 3 }[gate as "CNOT"] ?? 1;
        const wires = [0, 1, 2].sort(() => random() - 0.5).slice(0, arity);
        ops.push(op(gate, c, wires, ["Rx", "Ry", "Rz"].includes(gate) ? random() * 6 : undefined));
      }
      const out = run(circuit(n, ...ops));
      near(probabilities(out).reduce((a, b) => a + b, 0), 1, 1e-9);
    }
  });
});

describe("measurement", () => {
  it("samples repeatably from a seed, in the right proportions, and never an impossible outcome", () => {
    const bell = run(circuit(2, op("H", 0, [0]), op("CNOT", 1, [0, 1])));
    const a = sample(bell, 4000, mulberry32(1));
    const b = sample(bell, 4000, mulberry32(1));
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect([...a.keys()].sort()).toEqual(["00", "11"]);
    expect([...a.values()].reduce((x, y) => x + y, 0)).toBe(4000);
    expect(Math.abs((a.get("00") ?? 0) / 4000 - 0.5)).toBeLessThan(0.04);
    expect(sample(basisState(3, 5), 10).get("101")).toBe(10);
  });

  it("writes outcomes as bit strings with qubit 0 first", () => {
    expect(bitstring(3, 5)).toBe("101");
    expect(bitstring(2, 1)).toBe("01");
  });
});

describe("the Bloch sphere", () => {
  const vec = (c: Circuit, q = 0) => blochVector(run(c), q);

  it("puts the named states at the poles of each axis", () => {
    const zero = vec(circuit(1));
    near(zero.z, 1); near(zero.x, 0); near(zero.y, 0);
    near(vec(circuit(1, op("X", 0, [0]))).z, -1);
    const plus = vec(circuit(1, op("H", 0, [0])));
    near(plus.x, 1); near(plus.y, 0); near(plus.z, 0);
    near(vec(circuit(1, op("X", 0, [0]), op("H", 1, [0]))).x, -1);
    const plusI = vec(circuit(1, op("H", 0, [0]), op("S", 1, [0])));
    near(plusI.y, 1); near(plusI.x, 0);
    near(vec(circuit(1, op("H", 0, [0]), op("Sdg", 1, [0]))).y, -1);
  });

  it("turns as the rotation gates say: Ry in the xz-plane, Rx through -y, Rz around z", () => {
    const theta = 0.7;
    const ry = vec(circuit(1, op("Ry", 0, [0], theta)));
    near(ry.x, Math.sin(theta)); near(ry.z, Math.cos(theta)); near(ry.y, 0);
    const rx = vec(circuit(1, op("Rx", 0, [0], theta)));
    near(rx.y, -Math.sin(theta)); near(rx.z, Math.cos(theta)); near(rx.x, 0);
    const rz = vec(circuit(1, op("H", 0, [0]), op("Rz", 1, [0], theta)));
    near(rz.x, Math.cos(theta)); near(rz.y, Math.sin(theta)); near(rz.z, 0);
  });

  it("puts an entangled qubit at the centre, and a product-state qubit on the surface", () => {
    const bell = circuit(2, op("H", 0, [0]), op("CNOT", 1, [0, 1]));
    for (const q of [0, 1]) {
      const v = vec(bell, q);
      near(Math.hypot(v.x, v.y, v.z), 0);
    }
    const product = circuit(2, op("H", 0, [0]), op("X", 0, [1]));
    near(Math.hypot(...Object.values(vec(product, 0))), 1);
    near(vec(product, 1).z, -1);
  });
});

describe("comparing circuits", () => {
  it("knows a SWAP from three CNOTs, and that a CNOT isn't its reverse", () => {
    const swap = circuit(2, op("SWAP", 0, [0, 1]));
    const threeCnots = circuit(2, op("CNOT", 0, [0, 1]), op("CNOT", 1, [1, 0]), op("CNOT", 2, [0, 1]));
    near(unitaryOverlap(swap, threeCnots), 1);
    expect(unitaryOverlap(circuit(2, op("CNOT", 0, [0, 1])), circuit(2, op("CNOT", 0, [1, 0])))).toBeLessThan(0.9);
  });

  it("ignores a global phase but not a relative one", () => {
    near(unitaryOverlap(circuit(1, op("Rx", 0, [0], 2 * Math.PI)), circuit(1, op("Z", 0, [0]), op("Z", 1, [0]))), 1);
    expect(unitaryOverlap(circuit(1, op("S", 0, [0])), circuit(1, op("T", 0, [0])))).toBeLessThan(0.99);
  });
});

describe("validateCircuit", () => {
  it("accepts a good circuit and explains a bad one", () => {
    expect(validateCircuit(circuit(2, op("H", 0, [0]), op("CNOT", 1, [0, 1])))).toBeNull();
    expect(validateCircuit(circuit(0))).toMatch(/qubits/);
    expect(validateCircuit(circuit(7))).toMatch(/qubits/);
    expect(validateCircuit(circuit(1, op("H", 0, [3])))).toMatch(/isn't in the circuit/);
    expect(validateCircuit(circuit(2, op("CNOT", 0, [0])))).toMatch(/acts on 2/);
    expect(validateCircuit(circuit(2, op("CNOT", 0, [1, 1])))).toMatch(/different qubits/);
    expect(validateCircuit(circuit(2, op("H", 0, [0]), op("X", 0, [0])))).toMatch(/same wire/);
    expect(validateCircuit(circuit(1, op("Rx", 0, [0])))).toMatch(/angle/);
    expect(validateCircuit(circuit(1, op("H", -1, [0])))).toMatch(/column/);
    expect(() => run(circuit(1, op("H", 0, [9])))).toThrow();
  });
});

describe("notation", () => {
  const latex = (c: Circuit) => diracLatex(run(c));

  it("writes the named states the way a textbook does", () => {
    expect(latex(circuit(1))).toBe("|0\\rangle");
    expect(latex(circuit(1, op("X", 0, [0])))).toBe("|1\\rangle");
    expect(latex(circuit(1, op("H", 0, [0])))).toBe("\\frac{1}{\\sqrt{2}}\\left(|0\\rangle + |1\\rangle\\right)");
    expect(latex(circuit(1, op("X", 0, [0]), op("H", 1, [0])))).toBe("\\frac{1}{\\sqrt{2}}\\left(|0\\rangle - |1\\rangle\\right)");
    expect(latex(circuit(1, op("H", 0, [0]), op("S", 1, [0])))).toBe("\\frac{1}{\\sqrt{2}}\\left(|0\\rangle + i|1\\rangle\\right)");
    expect(latex(circuit(1, op("H", 0, [0]), op("Sdg", 1, [0])))).toBe("\\frac{1}{\\sqrt{2}}\\left(|0\\rangle - i|1\\rangle\\right)");
    expect(latex(circuit(1, op("H", 0, [0]), op("T", 1, [0])))).toContain("e^{i\\pi/4}|1\\rangle");
    expect(latex(circuit(2, op("H", 0, [0]), op("CNOT", 1, [0, 1])))).toBe("\\frac{1}{\\sqrt{2}}\\left(|00\\rangle + |11\\rangle\\right)");
    expect(latex(circuit(2, op("H", 0, [0]), op("H", 0, [1])))).toBe("\\frac{1}{2}\\left(|00\\rangle + |01\\rangle + |10\\rangle + |11\\rangle\\right)");
    expect(latex(circuit(3, op("H", 0, [0]), op("H", 0, [1]), op("H", 0, [2])))).toContain("\\frac{1}{\\sqrt{8}}");
  });

  it("falls back to decimals when the weights differ", () => {
    expect(latex(circuit(1, op("Ry", 0, [0], Math.PI / 3)))).toBe("0.866|0\\rangle + 0.5|1\\rangle");
    expect(latex(circuit(1, op("Ry", 0, [0], Math.PI / 3), op("Rz", 1, [0], 0.5)))).toMatch(/\(0\.\d+ [-+] 0\.\d+i\)/);
  });

  it("writes angles as fractions of π where it can", () => {
    expect(formatAngle(Math.PI)).toBe("π");
    expect(formatAngle(Math.PI / 2)).toBe("π/2");
    expect(formatAngle(Math.PI / 4)).toBe("π/4");
    expect(formatAngle((3 * Math.PI) / 4)).toBe("3π/4");
    expect(formatAngle(-Math.PI / 2)).toBe("-π/2");
    expect(formatAngle(2 * Math.PI)).toBe("2π");
    expect(formatAngle(0)).toBe("0");
    expect(formatAngle(0.5)).toBe("0.5 rad");
  });
});

describe("challenges", () => {
  it("are all solved by their reference solutions", () => {
    for (const c of CHALLENGES) {
      const result = checkChallenge(c, { qubits: c.qubits, ops: c.solution });
      expect(result.solved, c.id).toBe(true);
    }
  });

  it("are not solved by doing nothing, and have unique ids", () => {
    for (const c of CHALLENGES) expect(checkChallenge(c, { qubits: c.qubits, ops: [] }).solved, c.id).toBe(false);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
  });

  it("only use gates their own rules allow in the reference solution", () => {
    for (const c of CHALLENGES) for (const o of c.solution) expect(c.allowed, `${c.id}: ${o.gate}`).toContain(o.gate);
  });

  it("accept a different correct solution, but not a near miss", () => {
    const minus = CHALLENGES.find((c) => c.id === "minus")!;
    // H then Z also makes |−⟩, and so does X then H.
    expect(checkChallenge(minus, { qubits: 1, ops: [op("H", 0, [0]), op("Z", 1, [0])] }).solved).toBe(true);
    expect(checkChallenge(minus, { qubits: 1, ops: [op("H", 0, [0])] }).solved).toBe(false);
    const tilt = CHALLENGES.find((c) => c.id === "tilt")!;
    expect(checkChallenge(tilt, { qubits: 1, ops: [op("Ry", 0, [0], Math.PI / 4 + 0.01)] }).solved).toBe(false);
  });

  it("enforce the gate rules and the number of qubits", () => {
    const swap = CHALLENGES.find((c) => c.id === "swap")!;
    expect(checkChallenge(swap, { qubits: 2, ops: [op("SWAP", 0, [0, 1])] })).toEqual({ solved: false, reason: "The SWAP gate isn't allowed here." });
    expect(checkChallenge(swap, { qubits: 3, ops: [] }).reason).toMatch(/2 qubits/);
    expect(checkChallenge(swap, { qubits: 2, ops: [op("CNOT", 0, [0, 9])] }).reason).toMatch(/isn't in the circuit/);
  });

  it("check operations, not just one input: a circuit that only works on |00⟩ isn't a SWAP", () => {
    const swap = CHALLENGES.find((c) => c.id === "swap")!;
    expect(checkChallenge(swap, { qubits: 2, ops: [op("CNOT", 0, [0, 1])] }).solved).toBe(false);
  });
});
