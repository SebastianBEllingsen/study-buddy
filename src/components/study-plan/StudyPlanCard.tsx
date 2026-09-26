"use client";

import Link from "next/link";
import { ArrowRight, Route } from "lucide-react";
import type { StudyPlan } from "@/lib/studyPlan/types";
import { roadmapLabel } from "@/lib/studyPlan/roadmap";
import { chapterNumbers, formatDay, formatMinutes, nextChapter, planProgress } from "@/lib/studyPlanDisplay";
import { localToday } from "@/lib/studyPlan/schedule";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Pinned at the top of a course page once the course has a study plan:
// overall progress and the next chapter to work on, one click from the full
// plan.
export function StudyPlanCard({ courseId, plan }: { courseId: number; plan: StudyPlan }) {
  const progress = planProgress(plan);
  const next = nextChapter(plan);
  const numbers = chapterNumbers(plan.chapters);
  const percent = Math.round(progress.fraction * 100);
  const today = localToday();
  const nextSession = plan.options.schedule
    ? plan.sessions.find((s) => !s.done_at && s.date >= today)
    : undefined;
  const nextSessionChapter = nextSession ? plan.chapters.find((c) => c.id === nextSession.chapter_id) : undefined;

  return (
    <Card elevation="flat" className="py-0">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 font-heading text-base font-semibold">
            <Route className="size-4 shrink-0 text-focus" />
            <span className="truncate">{plan.title}</span>
          </div>
          {plan.chapters.length > 1 && (
            <p className="truncate text-xs text-muted-foreground" title="Chapters joined by + can be studied in parallel">
              {roadmapLabel(plan.chapters)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <div
              className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="Study plan progress"
            >
              <div className="h-full rounded-full bg-focus transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">
              {progress.chaptersDone} of {progress.chaptersTotal} chapters
            </span>
          </div>
          <p className="text-sm">
            {plan.status === "draft_topics" ? (
              <span className="text-muted-foreground">Next: mark which chapters you already know.</span>
            ) : plan.status === "generating" ? (
              <span className="text-muted-foreground">Finding resources…</span>
            ) : plan.status === "failed" ? (
              <span className="text-muted-foreground">Building stopped — open the plan to try again.</span>
            ) : next ? (
              <>
                <span className="text-muted-foreground">Next up: </span>
                {numbers.get(next.id)}. {next.title}
              </>
            ) : (
              <span className="text-muted-foreground">Every chapter is done.</span>
            )}
          </p>
          {nextSession && nextSessionChapter && plan.status === "ready" && (
            <p className="text-xs text-muted-foreground">
              Next session: {nextSession.date === today ? "today" : formatDay(nextSession.date)} ·{" "}
              {formatMinutes(nextSession.minutes)} on {nextSessionChapter.title}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 self-start sm:self-center"
          nativeButton={false}
          render={<Link href={`/courses/${courseId}/plan${next ? `#chapter-${next.id}` : ""}`} />}
        >
          {plan.status === "draft_topics" ? "Continue" : "Open plan"}
          <ArrowRight className="size-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
