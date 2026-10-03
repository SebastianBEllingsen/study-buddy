import { greatCircle, project } from "@/lib/quantum/bloch";

// One qubit on the Bloch sphere: |0⟩ at the top, |1⟩ at the bottom, |+⟩ and
// |-⟩ along x, |+i⟩ and |-i⟩ along y. A qubit entangled with the others sits
// inside the sphere, and at the centre when it's maximally so.

const SIZE = 132;
const C = SIZE / 2;
const R = 46;

const at = (p: { right: number; up: number }) => `${(C + p.right * R).toFixed(1)},${(C - p.up * R).toFixed(1)}`;
const path = (points: { right: number; up: number }[]) => `M${points.map(at).join(" L")}`;

const AXES: { label: string; to: [number, number, number] }[] = [
  { label: "|0⟩", to: [0, 0, 1] },
  { label: "|1⟩", to: [0, 0, -1] },
  { label: "|+⟩", to: [1, 0, 0] },
  { label: "|−⟩", to: [-1, 0, 0] },
  { label: "|+i⟩", to: [0, 1, 0] },
  { label: "|−i⟩", to: [0, -1, 0] },
];

export function BlochSphere({ qubit, vector }: { qubit: number; vector: { x: number; y: number; z: number } }) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  const tip = project(vector.x, vector.y, vector.z);
  const entangled = length < 0.98;
  return (
    <figure className="flex w-[132px] flex-col items-center gap-1">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Qubit ${qubit} on the Bloch sphere at x ${vector.x.toFixed(2)}, y ${vector.y.toFixed(2)}, z ${vector.z.toFixed(2)}`}
      >
        <circle cx={C} cy={C} r={R} className="fill-none stroke-border" strokeWidth={1.25} />
        <path d={path(greatCircle("xy"))} className="fill-none stroke-border" strokeWidth={1} strokeDasharray="3 3" />
        <path d={path(greatCircle("xz"))} className="fill-none stroke-border/60" strokeWidth={0.75} />
        {AXES.map(({ label, to }) => {
          const end = project(...to);
          const beyond = project(to[0] * 1.32, to[1] * 1.32, to[2] * 1.32);
          return (
            <g key={label}>
              <line x1={C} y1={C} x2={C + end.right * R} y2={C - end.up * R} className="stroke-border" strokeWidth={0.75} />
              <text
                x={C + beyond.right * R}
                y={C - beyond.up * R}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={8.5}
              >
                {label}
              </text>
            </g>
          );
        })}
        {length > 0.02 && <line x1={C} y1={C} x2={C + tip.right * R} y2={C - tip.up * R} className="stroke-focus" strokeWidth={2} strokeLinecap="round" />}
        <circle cx={C + tip.right * R} cy={C - tip.up * R} r={entangled && length < 0.02 ? 3 : 4} className="fill-focus" />
      </svg>
      <figcaption className="text-center text-xs text-muted-foreground">
        <span className="font-medium text-foreground">q{qubit}</span>
        {length < 0.02 ? " · at the centre: maximally entangled" : entangled ? " · inside: entangled with the others" : ""}
      </figcaption>
    </figure>
  );
}
