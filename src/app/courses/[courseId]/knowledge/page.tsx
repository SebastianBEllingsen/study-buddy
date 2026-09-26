"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { LoaderCircle, Network, Tags } from "lucide-react";
import { cn } from "cn";
import type { KnowledgeSummary } from "@/lib/review/knowledgeSummary";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface KnowledgeResponse extends KnowledgeSummary {
  course: { id: number; name: string };
  untaggedSets: number;
}

// Tagging runs a few sets per request; this caps the loop.
const MAX_TAG_ROUNDS = 20;

function recallTone(recall: number): string {
  if (recall >= 0.85) return "bg-focus";
  if (recall >= 0.6) return "bg-sage";
  if (recall >= 0.3) return "bg-amber";
  return "bg-clay";
}

export default function KnowledgePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const aiEnabled = useAiEnabled();
  const { data, error, mutate } = useSWR<KnowledgeResponse>(`/api/courses/${courseId}/knowledge`);
  const [tagging, setTagging] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const router = useRouter();

  async function drawMap() {
    setDrawing(true);
    const res = await fetch(`/api/courses/${courseId}/concept-map`, { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setDrawing(false);
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't draw the concept map");
      return;
    }
    router.push(`/canvas/${body.canvasId}`);
  }

  async function tagAll() {
    setTagging(true);
    try {
      for (let round = 0; round < MAX_TAG_ROUNDS; round++) {
        const res = await fetch(`/api/courses/${courseId}/concepts/tag`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(body.error ?? "Couldn't tag concepts");
          break;
        }
        await mutate();
        if (!body.remainingItems || !body.taggedItems) break;
      }
    } catch {
      toast.error("Couldn't tag concepts");
    } finally {
      setTagging(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load this course&apos;s concepts.</p>;
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/courses/${courseId}`} />}>{data.course.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Concepts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-2xl font-semibold">Concepts</h1>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/mistakes?courseId=${courseId}`} />}>
              Mistake log
            </Button>
            {aiEnabled && (
              <Explain id="concepts.map">
              <Button variant="outline" size="sm" onClick={() => void drawMap()} disabled={drawing}>
                {drawing ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Network className="size-3.5" />}
                {drawing ? "Drawing…" : "Draw concept map"}
              </Button>
              </Explain>
            )}
            <Button size="sm" nativeButton={false} render={<Link href={`/review?courseId=${courseId}`} />}>
              Review this course
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          How much of each concept you&apos;d recall right now, from your flashcard and quiz reviews. Weakest first —
          that&apos;s where your time goes furthest.
        </p>
      </div>

      {data.untaggedSets > 0 && (
        <Card elevation="flat" className="py-0">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span className="text-muted-foreground">
              {data.untagged} card{data.untagged === 1 ? "" : "s"} and question{data.untagged === 1 ? "" : "s"} in{" "}
              {data.untaggedSets} set{data.untaggedSets === 1 ? "" : "s"} aren&apos;t tagged with a concept yet.
            </span>
            {aiEnabled && (
              <Explain id="concepts.tag">
              <Button size="sm" variant="outline" onClick={() => void tagAll()} disabled={tagging}>
                {tagging ? (
                  <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Tags className="size-3.5" />
                )}
                {tagging ? "Tagging…" : "Tag them"}
              </Button>
              </Explain>
            )}
          </CardContent>
        </Card>
      )}

      {data.concepts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No concepts yet. New quizzes and flashcards are tagged as they&apos;re generated
          {data.untaggedSets > 0 ? "; tag your existing sets above." : "."}
        </p>
      ) : (
        <Card elevation="flat" className="py-0">
          <CardContent className="divide-y divide-border/60 py-1">
            {data.concepts.map((c) => {
              const percent = Math.round(c.recall * 100);
              return (
                <div key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="text-sm tabular-nums">{percent}%</span>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="meter"
                    aria-label={`${c.name} recall`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <div className={cn("h-full rounded-full", recallTone(c.recall))} style={{ width: `${percent}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {c.reviewed}/{c.items} reviewed
                    {c.due > 0 && ` · ${c.due} due`}
                    {c.openMistakes > 0 && ` · ${c.openMistakes} mistake${c.openMistakes === 1 ? "" : "s"}`}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
