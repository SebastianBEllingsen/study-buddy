"use client";

import { useDateFormatter } from "@/components/DateFormatProvider";
import { useEffect, useRef, useState } from "react";
import { HEATMAP_GAP, fitHeatmap, type HeatmapFit } from "@/lib/heatmapFit";

// A compact GitHub-style activity graph — quiz attempts and flashcard
// reviews per day. The streak counter already tells you "how many days in a
// row," but not "was last week actually lighter than usual" — this is the
// shape of that answer, not just a number.
// Room the "last N weeks" line takes above the grid: its own height plus
// the gap below it.
const LABEL_SPACE = 22;

function levelFor(count: number): string {
  if (count === 0) return "bg-muted";
  if (count === 1) return "bg-amber/25";
  if (count <= 3) return "bg-amber/50";
  if (count <= 6) return "bg-amber/75";
  return "bg-amber";
}

// "YYYY-MM-DD" as a local-midnight Date, for display.
function localDateOfKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Fills whatever space it's given: it measures itself, then picks the
// square size from the height and the number of weeks from the width (see
// lib/heatmapFit.ts) — a bigger widget tile shows a bigger, longer
// heatmap rather than a small fixed grid in one corner. `showLabel` drops
// the "last N weeks" line on the shortest tiles (see page.tsx).
export default function StudyHeatmap({
  activity,
  showLabel = true,
}: {
  activity: Record<string, number>;
  showLabel?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<HeatmapFit | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFit(fitHeatmap(width, height - (showLabel ? LABEL_SPACE : 0)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showLabel]);

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center">
      {fit && <HeatmapGrid activity={activity} weeksCount={fit.weeks} cell={fit.cell} showLabel={showLabel} />}
    </div>
  );
}

function HeatmapGrid({
  activity,
  weeksCount,
  cell,
  showLabel,
}: {
  activity: Record<string, number>;
  weeksCount: number;
  cell: number;
  showLabel: boolean;
}) {
  const fmt = useDateFormatter();
  // Always renders, even with zero activity anywhere — an all-empty grid is
  // itself the "nothing yet" state (same idea as GitHub's own contribution
  // graph), and the home page now places this widget deliberately rather
  // than showing it only opportunistically, so it shouldn't disappear.

  // Activity is keyed by local calendar day (see listStudyActivity), so the
  // grid starts from today's local date — then all the arithmetic below
  // runs in UTC on that date-only value (getUTCDay/setUTCDate), where no
  // timezone can shift it. Mixing local and UTC methods here previously
  // left the grid position and the toDateKey() label/lookup disagreeing by
  // a day.
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // Start on the first day (per the date format: Sunday or Monday) of the
  // week (weeksCount - 1) weeks before today's,
  // so the grid is always exactly weeksCount*7 days — a clean rectangle, no
  // trailing partial week. (A previous version re-read start.getDay()
  // *after* mutating start to compute the loop bound, picking up the
  // shifted day of week instead of today's — that off-by-a-few-days error
  // produced one extra day dangling past the last full column.)
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - ((today.getUTCDay() - fmt.weekStartsOn + 7) % 7) - (weeksCount - 1) * 7);

  const days: { key: string; date: Date; count: number }[] = [];
  for (let i = 0; i < weeksCount * 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = toDateKey(date);
    days.push({ key, date, count: activity[key] ?? 0 });
  }

  const weeks: (typeof days)[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showLabel && (
        <p className="truncate text-xs text-muted-foreground">Study activity — last {weeksCount} weeks</p>
      )}
      <div className="flex" style={{ gap: HEATMAP_GAP }}>
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col" style={{ gap: HEATMAP_GAP }}>
            {week.map((day) => {
              const isFuture = day.date > today;
              return (
                <div
                  key={day.key}
                  title={isFuture ? undefined : `${day.count} ${day.count === 1 ? "activity" : "activities"} on ${fmt.numericDate(localDateOfKey(day.key))}`}
                  style={{ width: cell, height: cell, borderRadius: Math.max(2, Math.round(cell / 5)) }}
                  className={isFuture ? "bg-transparent" : levelFor(day.count)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
