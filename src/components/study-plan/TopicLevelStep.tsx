"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";
import type { ChapterLevel, StudyPlan } from "@/lib/studyPlan/types";
import { chapterNumbers } from "@/lib/studyPlanDisplay";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const LEVEL_LABELS: Record<ChapterLevel, string> = {
  new: "New to me",
  familiar: "Seen it",
  known: "Know it",
};

// The plan page while a plan waits in "draft_topics": the chapters the AI
// worked out, each with a new / seen it / know it choice. "Find resources"
// sends the choices off and starts the resource step (see
// buildPlanResources) — the page then polls while it runs.
export function TopicLevelStep({
  plan,
  onStarted,
  onFinished,
}: {
  plan: StudyPlan;
  onStarted: () => void;
  onFinished: () => void;
}) {
  const [levels, setLevels] = useState<Record<number, ChapterLevel>>(() =>
    Object.fromEntries(plan.chapters.map((c) => [c.id, c.current_level ?? "new"]))
  );
  const [submitting, setSubmitting] = useState(false);
  const numbers = chapterNumbers(plan.chapters);
  const chapters = [...plan.chapters].sort((a, b) => a.position - b.position);

  async function handleBuild() {
    setSubmitting(true);
    // The build runs for a minute or two; let the page switch to its
    // "finding resources" view (and start polling) shortly after it begins.
    const started = setTimeout(onStarted, 1500);
    try {
      const res = await fetch(`/api/study-plans/${plan.id}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels }),
      });
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't build the plan");
        return;
      }
      toast.success("Study plan ready");
    } catch {
      toast.error("Couldn't build the plan");
    } finally {
      clearTimeout(started);
      setSubmitting(false);
      onFinished();
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold">What do you already know?</h2>
        <p className="text-sm text-muted-foreground">
          Chapters you&apos;ve seen get faster-paced material; ones you know get a single refresher.
          {plan.options.webResources ? " Resources are found once you continue." : ""}
        </p>
      </div>
      <div className="space-y-2">
        {chapters.map((chapter) => (
          <Card key={chapter.id} elevation="flat" className="py-0">
            <CardContent className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">
                  {numbers.get(chapter.id)}. {chapter.title}
                </p>
                {chapter.subtopics.length > 0 && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {chapter.subtopics.map((s) => s.text).join(" · ")}
                  </p>
                )}
              </div>
              <ToggleGroup
                value={[levels[chapter.id] ?? "new"]}
                onValueChange={(v: string[]) =>
                  v[0] && setLevels((prev) => ({ ...prev, [chapter.id]: v[0] as ChapterLevel }))
                }
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label={`How well you know ${chapter.title}`}
              >
                {(Object.keys(LEVEL_LABELS) as ChapterLevel[]).map((level) => (
                  <ToggleGroupItem key={level} value={level}>
                    {LEVEL_LABELS[level]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3">
        {submitting && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            This can take a minute or two.
          </span>
        )}
        <Button onClick={handleBuild} disabled={submitting}>
          {plan.options.webResources ? "Find resources" : "Finish plan"}
        </Button>
      </div>
    </div>
  );
}
