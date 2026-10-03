"use client";

import { useState } from "react";
import { MathText } from "@/components/MathText";
import { Button } from "@/components/ui/button";
import { bitstring, mulberry32, probabilities, sample, type State } from "@/lib/quantum/simulate";
import { diracLatex, formatAngle, phaseOf } from "@/lib/quantum/notation";

const MAX_ROWS = 16;
const SHOTS = 1000;

function PhaseDial({ phase }: { phase: number }) {
  return (
    <svg width={18} height={18} viewBox="-9 -9 18 18" role="img" aria-label={`Phase ${formatAngle(phase)}`} className="shrink-0">
      <circle r={7.5} className="fill-none stroke-border" strokeWidth={1} />
      <line x1={0} y1={0} x2={7.5 * Math.cos(phase)} y2={-7.5 * Math.sin(phase)} className="stroke-focus" strokeWidth={1.75} strokeLinecap="round" />
    </svg>
  );
}

function amplitudeText(re: number, im: number): string {
  const f = (x: number) => x.toFixed(3).replace(/\.?0+$/, "").replace(/^-0$/, "0");
  if (Math.abs(im) < 1e-9) return f(re);
  if (Math.abs(re) < 1e-9) return `${f(im)}i`;
  return `${f(re)} ${im < 0 ? "−" : "+"} ${f(Math.abs(im))}i`;
}

// The state as a formula, then each basis state that can be measured with its
// amplitude, its probability and its phase.
export function StateReadout({ state }: { state: State }) {
  const p = probabilities(state);
  const rows = p.map((prob, i) => ({ i, prob })).filter((r) => r.prob > 1e-9);
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto py-1 text-base" aria-label="The state">
        <MathText text={`$|\\psi\\rangle = ${diracLatex(state)}$`} />
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-normal">State</th>
            <th className="py-1 pr-3 font-normal">Amplitude</th>
            <th className="w-full py-1 font-normal">Probability</th>
            <th className="py-1 pl-3 font-normal">Phase</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ i, prob }) => (
            <tr key={i} className="border-t border-border/60">
              <td className="py-1 pr-3 font-mono">|{bitstring(state.n, i)}⟩</td>
              <td className="py-1 pr-3 font-mono text-xs whitespace-nowrap">{amplitudeText(state.re[i], state.im[i])}</td>
              <td className="py-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prob * 100)}>
                    <div className="h-full rounded-full bg-focus" style={{ width: `${Math.max(1, prob * 100)}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right tabular-nums">{(prob * 100).toFixed(1)}%</span>
                </div>
              </td>
              <td className="py-1 pl-3">
                <div className="flex items-center gap-1.5">
                  <PhaseDial phase={phaseOf(state.re[i], state.im[i])} />
                  <span className="w-9 text-xs text-muted-foreground">{formatAngle(phaseOf(state.re[i], state.im[i]))}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS && <p className="text-xs text-muted-foreground">and {rows.length - MAX_ROWS} more basis states with smaller or later entries.</p>}
    </div>
  );
}

// Measuring a thousand times: what actually comes out, next to what the
// state says should, so the noise in a finite number of shots is visible.
export function MeasurePanel({ state }: { state: State }) {
  // Results belong to the state they were measured from; a change clears them.
  const [measured, setMeasured] = useState<{ of: State; counts: [string, number][] } | null>(null);
  const current = measured && measured.of === state ? measured.counts : null;
  const expected = probabilities(state);

  function measure() {
    const counts = [...sample(state, SHOTS, mulberry32(Math.floor(Math.random() * 2 ** 31))).entries()].sort(([a], [b]) => a.localeCompare(b));
    setMeasured({ of: state, counts });
  }

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={measure}>
        Measure {SHOTS} times
      </Button>
      {current ? (
        <ul className="space-y-1.5 text-sm" aria-label="Measurement results">
          {current.map(([bits, count]) => {
            const index = parseInt(bits, 2);
            return (
              <li key={bits} className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-mono">|{bits}⟩</span>
                <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div className="h-full bg-focus/80" style={{ width: `${(count / SHOTS) * 100}%` }} />
                  <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `calc(${expected[index] * 100}% - 1px)` }} title={`expected ${(expected[index] * 100).toFixed(1)}%`} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {count} · {((count / SHOTS) * 100).toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Each measurement collapses the state to one basis state. Run it many times to see the odds.</p>
      )}
      {current && <p className="text-xs text-muted-foreground">The dark tick on each bar is the probability the state predicts.</p>}
    </div>
  );
}
