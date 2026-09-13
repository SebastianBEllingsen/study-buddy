"use client";

import { useState } from "react";

const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#eab308", "#ec4899"];
const PIECES = 24;

function randomPieces() {
  return Array.from({ length: PIECES }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.3,
    spin: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 180),
    color: COLORS[i % COLORS.length],
  }));
}

/**
 * A small, dependency-free celebration burst — a handful of absolutely
 * positioned divs with staggered CSS fall/fade keyframes (see
 * .animate-confetti-fall in globals.css). No canvas-confetti or similar
 * library; this is the whole thing.
 */
export function Confetti() {
  // Lazy useState initializer, not a plain render-body call — randomizes
  // once on mount, not on every re-render (React's purity rule flags
  // Math.random() called directly during render).
  const [pieces] = useState(randomPieces);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0 overflow-visible"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          className="animate-confetti-fall absolute top-0 block size-1.5 rounded-[1px]"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            ["--confetti-spin" as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
