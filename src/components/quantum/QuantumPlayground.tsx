"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Eraser, Lightbulb, Minus, Plus } from "lucide-react";
import { cn } from "cn";
import { MathText } from "@/components/MathText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BlochSphere } from "./BlochSphere";
import { CircuitEditor, GATE_LABEL } from "./CircuitEditor";
import { MeasurePanel, StateReadout } from "./StateReadout";
import { createStoredState } from "@/lib/createStoredState";
import { CHALLENGES, checkChallenge, challengeById } from "@/lib/quantum/challenges";
import { parseStoredCircuit, resizeQubits } from "@/lib/quantum/edit";
import { blochVector, run } from "@/lib/quantum/simulate";
import { MAX_QUBITS, ROTATIONS, validateCircuit, type Circuit, type GateName } from "@/lib/quantum/types";

// Build circuits, watch the state: the amplitudes, what measuring would give,
// and each qubit on its Bloch sphere — all computed here in the browser. Then
// try the challenges, checked by the same simulator.

const MAX_SANDBOX_QUBITS = 5;
const CIRCUIT_KEY = "studybuddy-quantum-circuit";
const SOLVED_KEY = "studybuddy-quantum-solved";

const SINGLE: GateName[] = ["H", "X", "Y", "Z", "S", "Sdg", "T", "Tdg", "Rx", "Ry", "Rz"];
const MULTI: GateName[] = ["CNOT", "CZ", "SWAP", "CCX"];

const EMPTY = (qubits: number): Circuit => ({ qubits, ops: [] });

const sandboxStore = createStoredState<Circuit>(CIRCUIT_KEY, (raw) => parseStoredCircuit(raw), EMPTY(2));
const solvedStore = createStoredState<string[]>(
  SOLVED_KEY,
  (raw) => (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && !!challengeById(id)) : []),
  []
);

export function QuantumPlayground() {
  const [mode, setMode] = useState<"sandbox" | string>("sandbox");
  const sandbox = sandboxStore.useValue();
  const solved = solvedStore.useValue();
  const [attempts, setAttempts] = useState<Record<string, Circuit>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<GateName>("H");
  const [angleInPi, setAngleInPi] = useState(0.5);

  const challenge = mode === "sandbox" ? undefined : challengeById(mode);
  const circuit = challenge ? (attempts[challenge.id] ?? EMPTY(challenge.qubits)) : sandbox;
  const valid = validateCircuit(circuit) === null;

  // `fromSolution`: the circuit is the reference solution being shown, which
  // doesn't count as solving it.
  function setCircuit(next: Circuit, fromSolution = false) {
    if (!challenge) {
      sandboxStore.write(next);
      return;
    }
    setAttempts((a) => ({ ...a, [challenge.id]: next }));
    // A challenge solved by the learner's own circuit is remembered, unless
    // the solution was looked at first.
    if (!fromSolution && !revealed.has(challenge.id) && !solved.includes(challenge.id) && checkChallenge(challenge, next).solved) {
      solvedStore.write([...solved, challenge.id]);
      toast.success(`Solved in ${next.ops.length} gate${next.ops.length === 1 ? "" : "s"}`);
    }
  }

  const state = useMemo(() => (valid ? run(circuit) : run(EMPTY(circuit.qubits))), [circuit, valid]);
  const vectors = useMemo(() => Array.from({ length: state.n }, (_, q) => blochVector(state, q)), [state]);
  const result = useMemo(() => (challenge ? checkChallenge(challenge, circuit) : null), [challenge, circuit]);
  const par = challenge?.solution.length ?? 0;

  function pick(id: string) {
    setMode(id);
    const c = challengeById(id);
    // A challenge's own gate rules decide what's selectable.
    if (c && !c.allowed.includes(selected)) setSelected(c.allowed[0]);
  }

  const allowed = challenge ? challenge.allowed : null;
  const angle = angleInPi * Math.PI;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">Quantum playground</h1>
        <p className="text-sm text-muted-foreground">
          Build a circuit and see the state it makes, what measuring it would give, and each qubit on its Bloch sphere. It all runs in your browser.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sandbox or challenge">
        <ModeChip active={mode === "sandbox"} onClick={() => pick("sandbox")}>
          Sandbox
        </ModeChip>
        {CHALLENGES.map((c) => (
          <ModeChip key={c.id} active={mode === c.id} onClick={() => pick(c.id)}>
            {solved.includes(c.id) && <CheckCircle2 className="size-3.5 text-sage" aria-label="Solved" />}
            {c.title}
          </ModeChip>
        ))}
      </div>

      {challenge && (
        <Card className="gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-semibold">{challenge.title}</h2>
            <Badge variant="outline">
              {challenge.qubits} qubit{challenge.qubits === 1 ? "" : "s"}
            </Badge>
            {challenge.allowed.length < 15 && <Badge variant="secondary">Only {challenge.allowed.map((g) => GATE_LABEL[g]).join(", ")}</Badge>}
          </div>
          <p className="leading-relaxed">
            <MathText text={challenge.goal} />
          </p>
          <ChallengeStatus
            solved={!!result?.solved}
            gates={circuit.ops.length}
            par={par}
            reason={result?.reason ?? null}
            hint={challenge.hint}
            wasRevealed={revealed.has(challenge.id)}
            onShowSolution={() => {
              setRevealed((r) => new Set(r).add(challenge.id));
              setCircuit({ qubits: challenge.qubits, ops: challenge.solution }, true);
            }}
          />
        </Card>
      )}

      <Card className="gap-4 px-4 py-4 sm:px-5">
        <Palette selected={selected} onSelect={setSelected} allowed={allowed} angleInPi={angleInPi} onAngle={setAngleInPi} />
        <CircuitEditor circuit={circuit} selected={selected} angle={angle} allowed={allowed} onChange={setCircuit} />
        <div className="flex flex-wrap items-center gap-2">
          {!challenge && (
            <div className="flex items-center gap-1" aria-label="Number of qubits">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Remove a qubit"
                disabled={circuit.qubits <= 1}
                onClick={() => setCircuit(resizeQubits(circuit, circuit.qubits - 1))}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="w-20 text-center text-sm tabular-nums">
                {circuit.qubits} qubit{circuit.qubits === 1 ? "" : "s"}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Add a qubit"
                disabled={circuit.qubits >= Math.min(MAX_SANDBOX_QUBITS, MAX_QUBITS)}
                onClick={() => setCircuit(resizeQubits(circuit, circuit.qubits + 1))}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          )}
          <Button variant="ghost" size="sm" disabled={circuit.ops.length === 0} onClick={() => setCircuit({ qubits: circuit.qubits, ops: [] })}>
            <Eraser className="size-3.5" />
            Clear
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {circuit.ops.length} gate{circuit.ops.length === 1 ? "" : "s"}
          </span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 px-5 py-4 lg:col-span-2">
          <h2 className="font-heading text-base font-semibold">The state</h2>
          <StateReadout state={state} />
        </Card>
        <Card className="gap-3 px-5 py-4">
          <h2 className="font-heading text-base font-semibold">Each qubit</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            {vectors.map((v, q) => (
              <BlochSphere key={q} qubit={q} vector={v} />
            ))}
          </div>
        </Card>
        <Card className="gap-3 px-5 py-4">
          <h2 className="font-heading text-base font-semibold">Measure it</h2>
          <MeasurePanel state={state} />
        </Card>
      </div>
    </div>
  );
}

function ModeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
        active ? "border-focus bg-focus/10 font-medium" : "hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

function ChallengeStatus({
  solved,
  gates,
  par,
  reason,
  hint,
  wasRevealed,
  onShowSolution,
}: {
  solved: boolean;
  gates: number;
  par: number;
  reason: string | null;
  hint: string;
  wasRevealed: boolean;
  onShowSolution: () => void;
}) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="space-y-2">
      {solved ? (
        <p className="flex items-center gap-2 text-sm font-medium text-sage">
          <CheckCircle2 className="size-4" />
          {wasRevealed ? "That's a solution." : `Solved in ${gates} gate${gates === 1 ? "" : "s"}`}
          {!wasRevealed && <span className="font-normal text-muted-foreground">{gates <= par ? "— as few as the reference solution" : `— the reference uses ${par}`}</span>}
        </p>
      ) : (
        reason && <p className="text-sm text-clay">{reason}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowHint((v) => !v)} aria-expanded={showHint}>
          <Lightbulb className="size-3.5" />
          {showHint ? "Hide hint" : "Hint"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onShowSolution}>
          Show a solution
        </Button>
      </div>
      {showHint && (
        <p className="text-sm text-muted-foreground">
          <MathText text={hint} />
        </p>
      )}
    </div>
  );
}

function Palette({
  selected,
  onSelect,
  allowed,
  angleInPi,
  onAngle,
}: {
  selected: GateName;
  onSelect: (gate: GateName) => void;
  allowed: GateName[] | null;
  angleInPi: number;
  onAngle: (value: number) => void;
}) {
  const button = (gate: GateName) => {
    const enabled = allowed === null || allowed.includes(gate);
    return (
      <Button
        key={gate}
        variant={selected === gate ? "default" : "outline"}
        size="sm"
        className="min-w-9 font-semibold"
        aria-pressed={selected === gate}
        disabled={!enabled}
        onClick={() => onSelect(gate)}
      >
        {GATE_LABEL[gate]}
      </Button>
    );
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="One-qubit gates">
          {SINGLE.map(button)}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Gates on several qubits">
          {MULTI.map(button)}
        </div>
      </div>
      {ROTATIONS.has(selected) && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="rotation-angle" className="text-muted-foreground">
            Angle
          </label>
          <Input
            id="rotation-angle"
            type="number"
            step={0.25}
            value={angleInPi}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onAngle(v);
            }}
            className="h-7 w-24"
          />
          <span className="text-muted-foreground">× π rad</span>
          <div className="flex gap-1">
            {[0.25, 0.5, 1].map((v) => (
              <Button key={v} variant="ghost" size="xs" onClick={() => onAngle(v)}>
                {v === 1 ? "π" : v === 0.5 ? "π/2" : "π/4"}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
