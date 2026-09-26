"use client";

import { Explain } from "@/components/Explain";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Lightbulb, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import type { MistakeListEntry, MistakeStatus } from "@/lib/review/mistakes";
import { CONFIDENCE_LABELS } from "@/lib/review/calibration";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { MathText } from "@/components/MathText";

// Stops a runaway loop if the model keeps skipping some mistakes.
const MAX_EXPLAIN_BATCHES = 5;

function MistakeCard({ mistake, onToggle }: { mistake: MistakeListEntry; onToggle: () => void }) {
  return (
    <Card elevation="flat" className="py-0">
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Link href={`/items/${mistake.generated_item_id}`} className="truncate hover:underline">
            {mistake.course_name} · {mistake.item_title}
          </Link>
          {mistake.concept_name && <Badge variant="secondary">{mistake.concept_name}</Badge>}
          {mistake.confidence && (
            <Badge variant="outline" className={mistake.confidence === "sure" ? "border-clay/40 text-clay" : undefined}>
              {CONFIDENCE_LABELS[mistake.confidence]}
            </Badge>
          )}
          {mistake.resolved_at && <Badge variant="outline">Resolved</Badge>}
        </div>
        <p className="leading-snug">
          <MathText text={mistake.prompt} />
        </p>
        <div className="grid gap-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
          {mistake.given_answer !== null && (
            <>
              <span className="text-muted-foreground">You answered</span>
              <span className="text-clay">
                <MathText text={mistake.given_answer} />
              </span>
            </>
          )}
          <span className="text-muted-foreground">Answer</span>
          <span className="text-sage">
            <MathText text={mistake.correct_answer} />
          </span>
        </div>
        {mistake.misconception && (
          <p className="flex gap-2 rounded-md bg-focus/10 px-3 py-2 text-sm">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-focus" />
            <span>{mistake.misconception}</span>
          </p>
        )}
        <div className="flex justify-end">
          <Explain id="mistakes.learned">
            <Button variant="ghost" size="sm" className="text-xs" onClick={onToggle}>
              {mistake.resolved_at ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
              {mistake.resolved_at ? "Reopen" : "Mark as learned"}
            </Button>
          </Explain>
        </div>
      </CardContent>
    </Card>
  );
}

function MistakesPageInner() {
  const raw = useSearchParams().get("courseId");
  const courseId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  const [status, setStatus] = useState<MistakeStatus>("open");
  const [explaining, setExplaining] = useState(false);
  const aiEnabled = useAiEnabled();
  const params = new URLSearchParams({ status });
  if (courseId !== null) params.set("courseId", String(courseId));
  const { data, error, mutate } = useSWR<{ mistakes: MistakeListEntry[] }>(`/api/mistakes?${params}`);
  const mistakes = data?.mistakes ?? [];
  const unexplained = mistakes.filter((m) => !m.resolved_at && !m.misconception).length;
  const courseName = courseId !== null ? mistakes[0]?.course_name : null;

  async function toggle(mistake: MistakeListEntry) {
    const res = await fetch(`/api/mistakes/${mistake.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: !mistake.resolved_at }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error("Couldn't update that mistake");
      return;
    }
    void mutate();
  }

  async function explain() {
    setExplaining(true);
    try {
      for (let batch = 0; batch < MAX_EXPLAIN_BATCHES; batch++) {
        const res = await fetch("/api/mistakes/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(body.error ?? "Couldn't explain your mistakes");
          break;
        }
        await mutate();
        if (!body.remaining || !body.labeled) break;
      }
    } catch {
      toast.error("Couldn't explain your mistakes");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
            </BreadcrumbItem>
            {courseId !== null && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link href={`/courses/${courseId}`} />}>{courseName ?? "Course"}</BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Mistake log</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-2xl font-semibold">Mistake log</h1>
          <div className="flex flex-wrap gap-1.5">
            {courseId !== null && (
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/mistakes" />}>
                All courses
              </Button>
            )}
            <Explain id="mistakes.redo">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href={courseId === null ? "/review?mode=mistakes" : `/review?mode=mistakes&courseId=${courseId}`} />
              }
            >
              Redo them now
            </Button>
            </Explain>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Every quiz question you got wrong and every card you rated Again. A mistake clears itself once you recall it
          correctly on two later days.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          value={[status]}
          onValueChange={(v: string[]) => v[0] && setStatus(v[0] as MistakeStatus)}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="open">Open</ToggleGroupItem>
          <ToggleGroupItem value="resolved">Resolved</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
        {aiEnabled && status !== "resolved" && unexplained > 0 && (
          <Explain id="mistakes.explain">
          <Button size="sm" variant="outline" onClick={() => void explain()} disabled={explaining}>
            {explaining ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {explaining ? "Explaining…" : `Explain my mistakes (${unexplained})`}
          </Button>
          </Explain>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive">Couldn&apos;t load your mistakes.</p>
      ) : !data ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : mistakes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {status === "open" ? "No open mistakes — nice." : "Nothing here yet."}
        </p>
      ) : (
        <div className="space-y-3">
          {mistakes.map((m) => (
            <MistakeCard key={m.id} mistake={m} onToggle={() => void toggle(m)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MistakesPage() {
  return (
    <Suspense fallback={null}>
      <MistakesPageInner />
    </Suspense>
  );
}
