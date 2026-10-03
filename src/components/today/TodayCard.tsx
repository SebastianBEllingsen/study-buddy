"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CircleCheck, ListChecks, Play, Sun } from "lucide-react";
import type { TodayStep } from "@/lib/today/planDay";
import type { OpenChapter } from "@/lib/today/loadToday";
import { startSession } from "@/lib/today/session";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePomodoro } from "@/components/pomodoro/PomodoroProvider";
import { FROSTED_CARD, useTodayCardLook } from "@/lib/useTransparentWidgets";
import { cn } from "cn";
import { saveTodaySession, todayUrl, useTodaySession, useTodaySync } from "./todayStore";
import { SessionStepList, StepLine, useOpenStep } from "./TodaySteps";

const LENGTHS = [15, 25, 45, 60, 90];

interface TodayResponse {
  minutes: number;
  steps: TodayStep[];
  date: string;
  chapters: OpenChapter[];
}

// The autopilot's one button: what today's session will be, and Start —
// which starts the focus timer and opens the first step. While a session
// runs, this is its task list.
export function TodayCard({ courseId }: { courseId: number | null }) {
  const session = useTodaySession();
  useTodaySync(session);
  // Settings: hidden or shown, and its look — a solid card, a see-through
  // frosted panel (FROSTED_CARD), or plain text on the picture (no surface, so
  // no side padding, to line up with the headings around it, and a halo).
  const { shown, look } = useTodayCardLook();
  const cardProps =
    look === "plain"
      ? { elevation: "flat" as const, className: "py-0 backdrop-legible" }
      : { className: cn("py-0", look === "frosted" && FROSTED_CARD) };
  const contentClass = cn("py-4", look === "plain" && "px-0");
  const [minutes, setMinutes] = useState<number | null>(null);
  // Chapters picked for today; none means the autopilot chooses.
  const [picked, setPicked] = useState<number[]>([]);
  const [choosing, setChoosing] = useState(false);
  // Nothing to fetch while the card is hidden.
  const { data, error } = useSWR<TodayResponse>(session || !shown ? null : todayUrl(courseId, minutes ?? undefined, picked), {
    keepPreviousData: true,
  });
  const pomodoro = usePomodoro();
  const open = useOpenStep();

  if (session) {
    return (
      <Card {...cardProps}>
        <CardContent className={cn("space-y-2", contentClass)}>
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <Sun className="size-4 text-amber" />
            Today&apos;s session
          </h2>
          <SessionStepList session={session} />
        </CardContent>
      </Card>
    );
  }

  // Hidden in Settings. (A session that's already running keeps its task list,
  // above.)
  if (!shown) return null;
  if (error) return null;
  if (!data) return <Skeleton className="h-32 rounded-xl" />;

  const length = minutes ?? data.minutes;
  const lengths = LENGTHS.includes(data.minutes) ? LENGTHS : [...LENGTHS, data.minutes].sort((a, b) => a - b);

  function start() {
    if (!data || data.steps.length === 0) return;
    saveTodaySession(startSession({ date: data.date, courseId, minutes: length, steps: data.steps, chapterIds: picked, now: Date.now() }));
    if (pomodoro.state.status !== "running") pomodoro.start();
    open(data.steps[0]);
  }

  return (
    <Card {...cardProps}>
      <CardContent className={cn("space-y-3", contentClass)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <Sun className="size-4 text-amber" />
            Today
          </h2>
          {data.steps.length > 0 && (
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
          )}
        </div>
        {data.chapters.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Explain id="today.choose">
                <Button variant="outline" size="sm" onClick={() => setChoosing((v) => !v)} aria-expanded={choosing}>
                  <ListChecks className="size-3.5" />
                  {picked.length > 0 ? `Studying ${picked.length} chosen` : "Choose chapters"}
                </Button>
              </Explain>
              {picked.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
                  Let Today choose
                </Button>
              )}
            </div>
            {choosing && <ChapterPicker chapters={data.chapters} picked={picked} onChange={setPicked} />}
          </div>
        )}
        {data.steps.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-sage" />
            <span>
              <span className="font-medium text-foreground">All caught up.</span> Nothing is due or planned — a study
              plan gives Today chapters to work through.
            </span>
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
                  className="tap-target text-xs text-muted-foreground hover:underline"
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

// The open chapters of the courses in scope, grouped by course.
function ChapterPicker({
  chapters,
  picked,
  onChange,
}: {
  chapters: OpenChapter[];
  picked: number[];
  onChange: (ids: number[]) => void;
}) {
  const courses = new Map<number, { name: string; chapters: OpenChapter[] }>();
  for (const c of chapters) {
    const course = courses.get(c.courseId) ?? { name: c.courseName, chapters: [] };
    course.chapters.push(c);
    courses.set(c.courseId, course);
  }
  const toggle = (id: number, on: boolean) => onChange(on ? [...picked, id] : picked.filter((p) => p !== id));
  return (
    <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border/60 p-2">
      {[...courses.entries()].map(([courseId, course]) => (
        <div key={courseId}>
          {courses.size > 1 && <p className="mb-1 text-xs font-medium text-muted-foreground">{course.name}</p>}
          <ul className="space-y-1">
            {course.chapters.map((c) => (
              <li key={c.chapterId}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={picked.includes(c.chapterId)} onCheckedChange={(v) => toggle(c.chapterId, !!v)} />
                  <span className="min-w-0 truncate">{c.chapterTitle}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
