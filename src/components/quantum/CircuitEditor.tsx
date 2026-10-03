"use client";

import { useRef, useState } from "react";
import { opAt, placeOp, removeOp, visibleColumns } from "@/lib/quantum/edit";
import { formatAngle } from "@/lib/quantum/notation";
import { GATE_ARITY, ROTATIONS, type Circuit, type GateName, type Op } from "@/lib/quantum/types";

// The drawing board: wires down the page, time left to right. Click a cell to
// place the selected gate; click a placed gate to take it off (or replace
// it). Multi-qubit gates take a click per wire, in one column. Arrow keys
// move between cells, Enter or Space acts, Delete removes, Escape cancels.

const CELL_W = 64;
const CELL_H = 48;
const LEFT = 40;
const TOP = 8;

export const GATE_LABEL: Record<GateName, string> = {
  H: "H", X: "X", Y: "Y", Z: "Z", S: "S", Sdg: "S†", T: "T", Tdg: "T†", Rx: "Rx", Ry: "Ry", Rz: "Rz", CNOT: "CNOT", CZ: "CZ", SWAP: "SWAP", CCX: "Toffoli",
};

// What to click next, for a gate that takes several wires.
const STEPS: Record<string, string[]> = {
  CNOT: ["the control wire", "the target wire"],
  CZ: ["the first wire", "the second wire"],
  SWAP: ["the first wire", "the second wire"],
  CCX: ["the first control wire", "the second control wire", "the target wire"],
};

interface Pending {
  gate: GateName;
  column: number;
  qubits: number[];
}

export function CircuitEditor({
  circuit,
  selected,
  angle,
  allowed,
  onChange,
}: {
  circuit: Circuit;
  selected: GateName;
  // Radians, for the rotation gates.
  angle: number;
  // Null: every gate.
  allowed: GateName[] | null;
  onChange: (circuit: Circuit) => void;
}) {
  const columns = visibleColumns(circuit);
  const [pendingGate, setPending] = useState<Pending | null>(null);
  const [active, setActive] = useState({ q: 0, col: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, SVGGElement>());

  // A half-placed gate only counts while its gate is still the selected one
  // and its wires still exist.
  const pending = pendingGate && pendingGate.gate === selected && pendingGate.qubits.every((q) => q < circuit.qubits) ? pendingGate : null;

  const width = LEFT + columns * CELL_W + 8;
  const height = TOP * 2 + circuit.qubits * CELL_H;
  const wireY = (q: number) => TOP + q * CELL_H + CELL_H / 2;
  const colX = (col: number) => LEFT + col * CELL_W + CELL_W / 2;
  const isAllowed = (gate: GateName) => allowed === null || allowed.includes(gate);

  function say(text: string | null) {
    setMessage(text);
  }

  function activate(q: number, col: number) {
    setActive({ q, col });
    const existing = opAt(circuit, col, q);
    if (!isAllowed(selected)) {
      say(`The ${GATE_LABEL[selected]} gate isn't allowed in this challenge.`);
      return;
    }
    const arity = GATE_ARITY[selected];
    if (arity === 1) {
      setPending(null);
      const op: Op = { gate: selected, column: col, qubits: [q], ...(ROTATIONS.has(selected) ? { angle } : {}) };
      const result = placeOp(circuit, op);
      if ("error" in result) say(result.error);
      else {
        say(null);
        onChange(result.circuit);
      }
      return;
    }
    // A gate on several wires.
    if (pending && pending.gate === selected && pending.column === col) {
      if (pending.qubits.includes(q)) {
        setPending(null);
        say(null);
        return;
      }
      const qubits = [...pending.qubits, q];
      if (qubits.length < arity) {
        setPending({ ...pending, qubits });
        say(`${GATE_LABEL[selected]}: click ${STEPS[selected][qubits.length]}.`);
        return;
      }
      setPending(null);
      const result = placeOp(circuit, { gate: selected, column: col, qubits });
      if ("error" in result) say(result.error);
      else {
        say(null);
        onChange(result.circuit);
      }
      return;
    }
    if (existing) {
      // An occupied cell with a multi-qubit gate selected: take the gate off.
      onChange(removeOp(circuit, col, q));
      say(null);
      return;
    }
    setPending({ gate: selected, column: col, qubits: [q] });
    say(`${GATE_LABEL[selected]}: click ${STEPS[selected][1]} in the same column.`);
  }

  function erase(q: number, col: number) {
    setPending(null);
    say(null);
    onChange(removeOp(circuit, col, q));
  }

  function move(q: number, col: number) {
    const next = { q: Math.min(circuit.qubits - 1, Math.max(0, q)), col: Math.min(columns - 1, Math.max(0, col)) };
    setActive(next);
    cellRefs.current.get(`${next.q}:${next.col}`)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, q: number, col: number) {
    if (e.key === "ArrowUp") move(q - 1, col);
    else if (e.key === "ArrowDown") move(q + 1, col);
    else if (e.key === "ArrowLeft") move(q, col - 1);
    else if (e.key === "ArrowRight") move(q, col + 1);
    else if (e.key === "Enter" || e.key === " ") activate(q, col);
    else if (e.key === "Delete" || e.key === "Backspace") erase(q, col);
    else if (e.key === "Escape") {
      setPending(null);
      say(null);
    } else return;
    e.preventDefault();
  }

  function describe(q: number, col: number): string {
    const op = opAt(circuit, col, q);
    const where = `Wire ${q}, step ${col + 1}`;
    if (!op) return `${where}: empty`;
    return `${where}: ${GATE_LABEL[op.gate]}${op.angle !== undefined ? ` ${formatAngle(op.angle)}` : ""}${op.qubits.length > 1 ? ` on wires ${op.qubits.join(", ")}` : ""}`;
  }

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-lg border bg-card/50">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Quantum circuit" className="block text-foreground">
          {/* Wires */}
          {Array.from({ length: circuit.qubits }, (_, q) => (
            <g key={q}>
              <text x={8} y={wireY(q)} dominantBaseline="middle" className="fill-muted-foreground" fontSize={12}>
                q{q}
              </text>
              <line x1={LEFT - 6} y1={wireY(q)} x2={width - 6} y2={wireY(q)} className="stroke-border" strokeWidth={1.5} />
            </g>
          ))}

          {/* Placed gates */}
          {circuit.ops.map((op, i) => (
            <OpShape key={i} op={op} x={colX(op.column)} ys={op.qubits.map(wireY)} />
          ))}

          {/* A gate being placed */}
          {pending?.qubits.map((q) => (
            <circle key={q} cx={colX(pending.column)} cy={wireY(q)} r={6} className="fill-focus/30 stroke-focus" strokeWidth={1.5} />
          ))}

          {/* Cells: the click targets */}
          {Array.from({ length: circuit.qubits }, (_, q) =>
            Array.from({ length: columns }, (_, col) => {
              const isActive = active.q === q && active.col === col;
              return (
                <g
                  key={`${q}:${col}`}
                  ref={(el) => {
                    if (el) cellRefs.current.set(`${q}:${col}`, el);
                    else cellRefs.current.delete(`${q}:${col}`);
                  }}
                  role="button"
                  tabIndex={isActive ? 0 : -1}
                  aria-label={describe(q, col)}
                  onClick={() => activate(q, col)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    erase(q, col);
                  }}
                  onFocus={() => setActive({ q, col })}
                  onKeyDown={(e) => onKeyDown(e, q, col)}
                  className="group/cell cursor-pointer outline-none"
                >
                  <rect
                    x={LEFT + col * CELL_W + 2}
                    y={TOP + q * CELL_H + 2}
                    width={CELL_W - 4}
                    height={CELL_H - 4}
                    rx={6}
                    className="fill-transparent group-hover/cell:fill-focus/10 group-focus-visible/cell:stroke-focus group-focus-visible/cell:stroke-2"
                  />
                </g>
              );
            })
          )}
        </svg>
      </div>
      <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {message ?? (pending ? "" : "Click a cell to place the selected gate; click a gate to remove it. Right-click or Delete also removes.")}
      </p>
    </div>
  );
}

function OpShape({ op, x, ys }: { op: Op; x: number; ys: number[] }) {
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const line = ys.length > 1 && <line x1={x} y1={top} x2={x} y2={bottom} className="stroke-foreground" strokeWidth={1.75} />;
  const dot = (y: number) => <circle key={y} cx={x} cy={y} r={4.5} className="fill-foreground" />;
  const plus = (y: number) => (
    <g key={y}>
      <circle cx={x} cy={y} r={11} className="fill-card stroke-foreground" strokeWidth={1.75} />
      <line x1={x - 11} y1={y} x2={x + 11} y2={y} className="stroke-foreground" strokeWidth={1.75} />
      <line x1={x} y1={y - 11} x2={x} y2={y + 11} className="stroke-foreground" strokeWidth={1.75} />
    </g>
  );
  const cross = (y: number) => (
    <g key={y} className="stroke-foreground" strokeWidth={2.25} strokeLinecap="round">
      <line x1={x - 6} y1={y - 6} x2={x + 6} y2={y + 6} />
      <line x1={x - 6} y1={y + 6} x2={x + 6} y2={y - 6} />
    </g>
  );

  if (op.gate === "CNOT") return <g>{line}{dot(ys[0])}{plus(ys[1])}</g>;
  if (op.gate === "CCX") return <g>{line}{dot(ys[0])}{dot(ys[1])}{plus(ys[2])}</g>;
  if (op.gate === "CZ") return <g>{line}{ys.map(dot)}</g>;
  if (op.gate === "SWAP") return <g>{line}{ys.map(cross)}</g>;

  const rotation = op.angle !== undefined;
  return (
    <g>
      <rect x={x - 17} y={ys[0] - 15} width={34} height={30} rx={5} className="fill-card stroke-foreground" strokeWidth={1.75} />
      <text x={x} y={rotation ? ys[0] - 3 : ys[0]} textAnchor="middle" dominantBaseline="middle" className="fill-foreground" fontSize={rotation ? 12 : 15} fontWeight={600}>
        {GATE_LABEL[op.gate]}
      </text>
      {rotation && (
        <text x={x} y={ys[0] + 8} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" fontSize={8.5}>
          {formatAngle(op.angle as number)}
        </text>
      )}
    </g>
  );
}
