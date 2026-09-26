"use client";

import { Explain } from "@/components/Explain";
import { cn } from "cn";
import { CONFIDENCES, type Confidence } from "@/lib/review/types";
import { CONFIDENCE_LABELS } from "@/lib/review/calibration";

// "How sure are you?" — tapped before the answer is shown. Optional: an
// answer without one is still graded, it just can't tell a lucky guess
// from real recall. `shortcuts` shows the 1–3 key hints.
export function ConfidencePicker({
  value,
  onChange,
  disabled,
  shortcuts,
  label = "How sure are you?",
}: {
  value: Confidence | null;
  onChange: (value: Confidence) => void;
  disabled?: boolean;
  shortcuts?: boolean;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {CONFIDENCES.map((c, i) => (
          <Explain key={c} id={`confidence.${c}`}>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value === c}
            onClick={(e) => {
              e.stopPropagation();
              onChange(c);
            }}
            className={cn(
              "px-2.5 py-1 text-xs transition-colors not-first:border-l not-first:border-border disabled:cursor-default",
              value === c ? "bg-focus/15 font-medium text-focus" : "text-muted-foreground enabled:hover:bg-muted"
            )}
          >
            {CONFIDENCE_LABELS[c]}
            {shortcuts && <kbd className="ml-1 font-sans text-[0.65rem] opacity-60">{i + 1}</kbd>}
          </button>
          </Explain>
        ))}
      </div>
    </div>
  );
}
