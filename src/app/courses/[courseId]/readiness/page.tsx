"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarClock, Gauge } from "lucide-react";
import { cn } from "cn";
import type { Readiness } from "@/lib/readiness/load";
import type { ForecastGroup } from "@/lib/readiness/forecast";
import { looksLikeExamEvent } from "@/lib/exams/detect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface ReadinessResponse extends Readiness {
  course: { id: number; name: string };
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function tone(n: number) {
  return n >= 0.85 ? "bg-focus" : n >= 0.65 ? "bg-sage" : n >= 0.4 ? "bg-amber" : "bg-clay";
}

function GroupRows({ groups }: { groups: ForecastGroup[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {groups.map((g) => (
        <li key={`${g.chapterId}:${g.name}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5">
          <span className="truncate text-sm font-medium">{g.name}</span>
          <span className="text-sm tabular-nums">{pct(g.ifKeptUp)}</span>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("absolute inset-y-0 left-0 rounded-full opacity-35", tone(g.ifKeptUp))} style={{ width: pct(g.ifKeptUp) }} />
            <div className={cn("absolute inset-y-0 left-0 rounded-full", tone(g.ifStopped))} style={{ width: pct(g.ifStopped) }} />
          </div>
          <span className="text-xs text-muted-foreground">
            {g.reviewed}/{g.items} learned
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ReadinessPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const key = `/api/courses/${courseId}/readiness`;
  const { data, error, mutate } = useSWR<ReadinessResponse>(key);
  const { data: calendar } = useSWR<{ events: CalendarEvent[] }>("/api/calendar/events?maxResults=100");
  const [draft, setDraft] = useState<string | null>(null);

  async function saveDate(examDate: string | null) {
    const res = await fetch(key, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examDate }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error("Couldn't save the date");
      return;
    }
    setDraft(null);
    void mutate();
  }

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load the forecast.</p>;
  if (!data) return <Skeleton className="h-64 rounded-xl" />;

  const suggestions = (calendar?.events ?? [])
    .filter((e) => looksLikeExamEvent(e.title))
    .slice(0, 5)
    .map((e) => ({ label: e.title, date: e.start.slice(0, 10) }));
  if (data.planDeadline && data.source !== "plan") suggestions.unshift({ label: "Study plan finish date", date: data.planDeadline });
  const f = data.forecast;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href={`/courses/${courseId}`} className="text-sm text-muted-foreground hover:underline">
          ← {data.course.name}
        </Link>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
          <Gauge className="size-6 text-focus" />
          Exam readiness
        </h1>
        <p className="text-sm text-muted-foreground">
          How much you&apos;d recall on your exam or goal date, projected with your spaced-repetition memory model —
          if you keep up your reviews, and if you stopped today.
        </p>
      </div>

      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Exam or goal date</span>
            <Input
              type="date"
              className="h-8 w-44"
              value={draft ?? data.examDate ?? ""}
              onChange={(e) => setDraft(e.target.value)}
            />
            {draft !== null && draft !== (data.examDate ?? "") && (
              <Button size="sm" onClick={() => void saveDate(draft || null)}>
                Save
              </Button>
            )}
            {data.source === "set" && (
              <Button size="sm" variant="ghost" onClick={() => void saveDate(null)}>
                Clear
              </Button>
            )}
            {data.source === "plan" && <span className="text-xs text-muted-foreground">from the study plan&apos;s finish date</span>}
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">From your calendar:</span>
              {suggestions.map((s) => (
                <Explain key={`${s.label}:${s.date}`} id="readiness.suggestion">
                  <button type="button" onClick={() => void saveDate(s.date)} className="rounded-md border px-2 py-0.5 hover:bg-muted">
                    {s.label} · {s.date}
                  </button>
                </Explain>
              ))}
            </div>
          )}
          {data.mode.active && (
            <p className="rounded-md bg-amber/10 px-3 py-2 text-sm">
              <Badge variant="outline" className="mr-2 border-amber/40 text-amber">
                Exam mode
              </Badge>
              {data.mode.noNewMaterial
                ? "Final days: Today sticks to review and mixed practice — no new material."
                : "Today mixes in more practice across topics and schedules practice tests about 14, 7 and 3 days out."}
            </p>
          )}
        </CardContent>
      </Card>

      {!f ? (
        <p className="text-sm text-muted-foreground">Set an exam or goal date to see the forecast.</p>
      ) : f.overall.items === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to forecast yet — review some flashcards or answer quiz questions for this course first.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card elevation="flat" className="gap-1 px-4 py-4">
              <span className="text-xs text-muted-foreground">If you keep up your reviews</span>
              <span className="text-3xl font-semibold tabular-nums">{pct(f.overall.ifKeptUp)}</span>
            </Card>
            <Card elevation="flat" className="gap-1 px-4 py-4">
              <span className="text-xs text-muted-foreground">If you stopped today</span>
              <span className="text-3xl font-semibold tabular-nums">{pct(f.overall.ifStopped)}</span>
            </Card>
            <Card elevation="flat" className="gap-1 px-4 py-4">
              <span className="text-xs text-muted-foreground">
                {f.daysLeft >= 0 ? `${f.daysLeft} day${f.daysLeft === 1 ? "" : "s"} to go` : "The date has passed"}
              </span>
              <span className="text-3xl font-semibold tabular-nums">
                {f.overall.reviewed}/{f.overall.items}
              </span>
              <span className="text-xs text-muted-foreground">items learned so far</span>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Solid bar: recall if you stopped today. Faint bar: recall if you keep up your reviews. Items you
            haven&apos;t learned yet count as zero either way — learning them is where the biggest gains are.
          </p>
          {f.chapters.length > 0 && (
            <section className="space-y-1">
              <h2 className="font-heading text-base font-semibold">By chapter</h2>
              <GroupRows groups={f.chapters} />
            </section>
          )}
          <section className="space-y-1">
            <h2 className="font-heading text-base font-semibold">By concept</h2>
            <GroupRows groups={f.concepts} />
          </section>
        </>
      )}

      {data.mockScores.length > 0 && (
        <section className="space-y-1">
          <h2 className="font-heading text-base font-semibold">Mock exams</h2>
          <ul className="space-y-1 text-sm">
            {data.mockScores.map((m, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {m.title} · {m.date}
                </span>
                <span className="tabular-nums">{pct(m.fraction)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
