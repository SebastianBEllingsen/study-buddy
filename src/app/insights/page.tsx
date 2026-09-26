"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Lightbulb, LineChart } from "lucide-react";
import type { Insights } from "@/lib/insights/load";
import { CONFIDENCE_LABELS } from "@/lib/review/calibration";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card elevation="flat" className="gap-0.5 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </Card>
  );
}

function InsightsInner() {
  const raw = useSearchParams().get("courseId");
  const courseId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  const { data, error } = useSWR<Insights>(courseId === null ? "/api/insights" : `/api/insights?courseId=${courseId}`);

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load your insights.</p>;
  if (!data) return <Skeleton className="h-64 rounded-xl" />;
  const { week } = data;
  const planned = week.plannedMinutes > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href={courseId === null ? "/" : `/courses/${courseId}`} className="text-sm text-muted-foreground hover:underline">
          ← Back
        </Link>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
          <LineChart className="size-6 text-focus" />
          Your week
        </h1>
        <p className="text-sm text-muted-foreground">The last seven days, and how well your confidence matches your results.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Reviews"
          value={String(week.reviews)}
          note={week.reviewAccuracy === null ? undefined : `${Math.round(week.reviewAccuracy * 100)}% right · ${week.activeDays} active day${week.activeDays === 1 ? "" : "s"}`}
        />
        <Stat
          label="Plan time"
          value={planned ? `${week.doneMinutes}/${week.plannedMinutes}` : "—"}
          note={planned ? "minutes done / planned" : "No scheduled study plan sessions"}
        />
        <Stat
          label="Mistakes"
          value={`+${week.newMistakes} / −${week.resolvedMistakes}`}
          note="new / cleared"
        />
        <Stat label="Quizzes taken" value={String(week.quizzes)} />
        <Stat label="Mock exams graded" value={String(week.mockExams)} />
        <Stat label="Blurts & explanations" value={String(week.explained)} />
      </div>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Calibration</h2>
        <p className="text-sm text-muted-foreground">
          From the last 30 days of answers where you said how sure you were.
          {data.calibrationVerdict && <span className="text-foreground"> {data.calibrationVerdict}</span>}
        </p>
        <Card elevation="flat" className="py-0">
          <CardContent className="divide-y divide-border/60 py-1">
            {data.calibration.map((row) => (
              <div key={row.confidence} className="grid grid-cols-[6rem_minmax(0,1fr)_7rem] items-center gap-3 py-2.5 text-sm">
                <span>{CONFIDENCE_LABELS[row.confidence]}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-focus" style={{ width: `${Math.round((row.accuracy ?? 0) * 100)}%` }} />
                </div>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                  {row.accuracy === null ? "no answers" : `${Math.round(row.accuracy * 100)}% of ${row.answers}`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Top misconceptions</h2>
        {data.misconceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None noted yet — &quot;Explain my mistakes&quot; in the mistake log, graded mock exams and blurts fill this in.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.misconceptions.map((m, i) => (
              <li key={i} className="flex gap-2 rounded-md bg-focus/10 px-3 py-2 text-sm">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-focus" />
                <span>
                  {m.misconception}
                  {m.concept && <span className="text-muted-foreground"> · {m.concept}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href={courseId === null ? "/mistakes" : `/mistakes?courseId=${courseId}`} className="text-sm hover:underline">
          Open the mistake log →
        </Link>
      </section>
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsInner />
    </Suspense>
  );
}
