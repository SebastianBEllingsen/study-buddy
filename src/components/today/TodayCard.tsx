"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Play, Sun } from "lucide-react";
import type { TodayStep } from "@/lib/today/planDay";
import { startSession } from "@/lib/today/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePomodoro } from "@/components/pomodoro/PomodoroProvider";
import { saveTodaySession, todayUrl, useTodaySession, useTodaySync } from "./todayStore";
import { SessionStepList, StepLine, useOpenStep } from "./TodaySteps";

const LENGTHS = [15, 25, 45, 60, 90];

interface TodayResponse {
  minutes: number;
  steps: TodayStep[];
  date: string;
}

// The autopilot's one button: what today's session will be, and Start —
// which starts the focus timer and opens the first step. While a session
// runs, this is its task list.
export function TodayCard({ courseId }: { courseId: number | null }) {
  const session = useTodaySession();
  useTodaySync(session);
  const [minutes, setMinutes] = useState<number | null>(null);
  const { data, error } = useSWR<TodayResponse>(session ? null : todayUrl(courseId, minutes ?? undefined), {
    keepPreviousData: true,
  });
  const pomodoro = usePomodoro();
  const open = useOpenStep();

  if (session) {
    return (
      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-2 py-4">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <Sun className="size-4 text-amber" />
            Today&apos;s session
          </h2>
          <SessionStepList session={session} />
        </CardContent>
      </Card>
    );
  }

  if (error) return null;
  if (!data) return <Skeleton className="h-32 rounded-xl" />;

  const length = minutes ?? data.minutes;
  const lengths = LENGTHS.includes(data.minutes) ? LENGTHS : [...LENGTHS, data.minutes].sort((a, b) => a - b);

  function start() {
    if (!data || data.steps.length === 0) return;
    saveTodaySession(startSession({ date: data.date, courseId, minutes: length, steps: data.steps, now: Date.now() }));
    if (pomodoro.state.status !== "running") pomodoro.start();
    open(data.steps[0]);
  }

  return (
    <Card elevation="flat" className="py-0">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <Sun className="size-4 text-amber" />
            Today
          </h2>
          <Explain id="today.length">
          <ToggleGroup
            value={[String(length)]}
            onValueChange={(v: string[]) => v[0] && setMinutes(Number(v[0]))}
            size="sm"
            variant="outline"
            aria-label="Session length"
          >
            {lengths.map((m) => (
              <ToggleGroupItem key={m} value={String(m)}>
                {m} min
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          </Explain>
        </div>
        {data.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing due and nothing planned — you&apos;re all caught up. A study plan gives the autopilot chapters to
            work through.
          </p>
        ) : (
          <>
            <ol className="space-y-1.5">
              {data.steps.map((step, i) => (
                <li key={step.id} className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                  <StepLine step={step} />
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Explain id="today.start">
                <Button onClick={start}>
                  <Play className="size-4" />
                  Start {length}-minute session
                </Button>
              </Explain>
              <Explain id="today.week">
                <Link
                  href={courseId === null ? "/insights" : `/insights?courseId=${courseId}`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Your week →
                </Link>
              </Explain>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
